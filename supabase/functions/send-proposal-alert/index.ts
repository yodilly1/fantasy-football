import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] || character));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let proposalId: string | null = null;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const brevoKey = Deno.env.get('BREVO_API_KEY');
    const senderEmail = Deno.env.get('LEAGUE_SENDER_EMAIL') || 'clarityce@gmail.com';
    const leagueUrl = Deno.env.get('LEAGUE_APP_URL') || 'https://fantasy-football.lee-403.workers.dev/';
    if (!brevoKey) throw new Error('Email delivery is not configured yet.');

    const memberClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } = await memberClient.auth.getUser();
    if (userError || !userData.user) throw new Error('League sign-in required.');

    ({ proposalId } = await request.json());
    if (!proposalId) throw new Error('Proposal ID is required.');
    const { data: managerId, error: managerError } = await memberClient.rpc('current_manager_id');
    if (managerError || !managerId) throw new Error('League manager not found.');
    const { data: proposal, error: proposalError } = await memberClient.from('proposals').select('*').eq('id', proposalId).single();
    if (proposalError || !proposal) throw new Error('Proposal not found.');
    if (proposal.author_manager_id !== managerId) throw new Error('Only the proposal author can send its alert.');
    if (proposal.alert_sent_at) return Response.json({ sent: proposal.alert_recipient_count, alreadySent: true }, { headers: corsHeaders });

    const { data: memberships, error: membershipError } = await adminClient
      .from('team_memberships')
      .select('managers(auth_user_id,display_name),teams(display_name)')
      .eq('season_id', proposal.season_id);
    if (membershipError) throw membershipError;
    const authIds = new Set((memberships || []).map((row: any) => row.managers?.auth_user_id).filter(Boolean));
    const { data: usersPage, error: usersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    const recipients = usersPage.users.filter((user) => authIds.has(user.id) && user.email).map((user) => user.email!);
    if (!recipients.length) throw new Error('No claimed manager email addresses are available.');

    const author = (memberships || []).find((row: any) => row.managers?.auth_user_id === userData.user.id) as any;
    const authorName = author?.managers?.display_name || author?.teams?.display_name || 'A league manager';
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({
        sender: { name: 'Ugh Who Cares League HQ', email: senderEmail },
        to: recipients.map((email) => ({ email })),
        subject: `League vote: ${proposal.title}`,
        htmlContent: `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #e6e9ee;border-radius:14px;padding:28px"><div style="font-size:12px;font-weight:700;color:#244f73;letter-spacing:.08em;text-transform:uppercase">Ugh Who Cares · League vote</div><h1 style="font-size:26px;line-height:1.2;margin:14px 0 10px">${escapeHtml(proposal.title)}</h1><p style="font-size:14px;line-height:1.6;color:#667085">${escapeHtml(proposal.description)}</p>${proposal.proposed_value ? `<p style="font-size:15px"><strong>${escapeHtml(proposal.current_value || 'Current')}</strong> &rarr; <strong>${escapeHtml(proposal.proposed_value)}</strong></p>` : ''}<p style="font-size:12px;color:#667085">Proposed by ${escapeHtml(authorName)} · ${proposal.required_yes_votes} yes votes required</p><a href="${leagueUrl}" style="display:inline-block;margin-top:12px;background:#244f73;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-size:13px;font-weight:700">Open League HQ and vote</a></div></div></body></html>`,
      }),
    });
    const delivery = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(delivery.message || `Email provider returned ${response.status}.`);
    await adminClient.from('proposals').update({ alert_sent_at: new Date().toISOString(), alert_recipient_count: recipients.length, alert_error: null }).eq('id', proposal.id);
    return Response.json({ sent: recipients.length }, { headers: corsHeaders });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Email alert failed.';
    if (proposalId) {
      try {
        const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await adminClient.from('proposals').update({ alert_error: message.slice(0, 500) }).eq('id', proposalId);
      } catch { /* best-effort audit only */ }
    }
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});

