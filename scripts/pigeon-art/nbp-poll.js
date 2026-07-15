// Считаем статусы последних 30 джоб nano-banana (png)
const t = await window.Clerk.session.getToken();
const r = await fetch('https://fnf.higgsfield.ai/jobs/accessible?page=1&size=30', { headers: { authorization: 'Bearer ' + t } });
const j = await r.json();
const counts = {};
const bySet = {};
for (const job of (j.jobs || [])) {
  counts[job.status] = (counts[job.status] || 0) + 1;
  const res = job.results ? (job.results.raw?.url || job.results.min?.url || null) : null;
  if (res && res.endsWith('.png')) bySet[job.job_set_id] = res;
}
return JSON.stringify({ counts, pngSets: Object.keys(bySet).length, bySet });
