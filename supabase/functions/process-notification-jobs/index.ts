import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
};

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] || character));

async function recipients(admin: any, seasonId: string) {
  const { data: memberships, error } = await admin
    .from('team_memberships').select('managers(auth_user_id)').eq('season_id', seasonId);
  if (error) throw error;
  const authIds = new Set((memberships || []).map((row: any) => row.managers?.auth_user_id).filter(Boolean));
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  return users.users.filter((user: any) => authIds.has(user.id) && user.email).map((user: any) => user.email);
}

async function sendEmail(emailKey: string, senderEmail: string, to: string[], subject: string, htmlContent: string) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {'api-key': emailKey, 'Content-Type': 'application/json', accept: 'application/json'},
    body: JSON.stringify({sender: {name: 'Ugh Who Cares League HQ', email: senderEmail}, to: to.map((email) => ({email})), subject, htmlContent}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Email provider returned ${response.status}.`);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const brevoKey = Deno.env.get('BREVO_API_KEY');
    const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET');
    const authorizedCron = Boolean(cronSecret && request.headers.get('x-cron-secret') === cronSecret);
    if (!authorizedCron) {
      const memberClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {global: {headers: {Authorization: request.headers.get('Authorization') || ''}}});
      const {data, error} = await memberClient.auth.getUser();
      if (error || !data.user) throw new Error('League sign-in required.');
    }
    if (!brevoKey) throw new Error('Email delivery is not configured yet.');

    const admin = createClient(url, serviceKey);
    const now = new Date().toISOString();
    const {data: jobs, error} = await admin.from('notification_jobs')
      .select('*, proposals(title,description,proposed_value,current_value,required_yes_votes), draft_options(starts_at)')
      .lte('due_at', now).in('status', ['pending', 'failed']).order('due_at').limit(20);
    if (error) throw error;
    let sent = 0;
    for (const job of jobs || []) {
      const {data: claim} = await admin.from('notification_jobs').update({status: 'processing', claimed_at: now, attempts: (job.attempts || 0) + 1})
        .eq('id', job.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
      if (!claim) continue;
      try {
        const to = await recipients(admin, job.season_id);
        if (!to.length) throw new Error('No claimed manager email addresses are available.');
        const proposal = job.proposals;
        let subject = 'League notification';
        let heading = 'League update';
        let copy = '';
        if (job.kind === 'proposal_open') {
          subject = `League vote: ${proposal.title}`; heading = 'A league vote is open';
          copy = `<p>${escapeHtml(proposal.description)}</p><p><strong>${escapeHtml(proposal.required_yes_votes)} yes votes are required.</strong></p>`;
        } else if (job.kind === 'proposal_passed') {
          subject = `Vote passed: ${proposal.title}`; heading = 'A league vote passed';
          copy = `<p>The league approved <strong>${escapeHtml(proposal.title)}</strong>.</p><p>${escapeHtml(proposal.description)}</p>`;
        } else {
          const draft = new Date(job.draft_options.starts_at);
          subject = 'Keeper deadline: 24 hours before the draft'; heading = 'Keeper choices are due soon';
          copy = `<p>Keeper choices are due by <strong>${escapeHtml(draft.toLocaleString('en-US', {timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short'}))} Eastern</strong>.</p><p>The draft starts 24 hours later.</p>`;
        }
        await sendEmail(brevoKey, Deno.env.get('LEAGUE_SENDER_EMAIL') || 'clarityce@gmail.com', to, subject,
          `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #e6e9ee;border-radius:14px;padding:28px"><div style="font-size:12px;font-weight:700;color:#244f73;letter-spacing:.08em;text-transform:uppercase">Ugh Who Cares · League HQ</div><h1>${escapeHtml(heading)}</h1>${copy}<a href="${escapeHtml(Deno.env.get('LEAGUE_APP_URL') || 'https://ugh-who-cares.pages.dev/') }" style="display:inline-block;margin-top:12px;background:#244f73;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-size:13px;font-weight:700">Open League HQ</a></div></div></body></html>`);
        await admin.from('notification_jobs').update({status: 'sent', sent_at: new Date().toISOString(), last_error: null}).eq('id', job.id);
        sent++;
      } catch (reason) {
        await admin.from('notification_jobs').update({status: 'failed', last_error: String(reason instanceof Error ? reason.message : reason).slice(0, 500)}).eq('id', job.id);
      }
    }
    return Response.json({processed: (jobs || []).length, sent}, {headers: corsHeaders});
  } catch (reason) {
    return Response.json({error: reason instanceof Error ? reason.message : 'Notification worker failed.'}, {status: 400, headers: corsHeaders});
  }
});
