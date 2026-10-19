// people-core.js — helpers for the People panel, shared by the browser
// (public/app.js) and the API (api/people.js). No dependencies.

// Hosts that belong to a job board / ATS, not the employer — useless as an
// email domain.
const NOT_EMPLOYER = /(^|\.)(greenhouse\.io|grnh\.se|ashbyhq\.com|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|icims\.com|smartrecruiters\.com|workable\.com|bamboohr\.com|oraclecloud\.com|taleo\.net|successfactors\.com|sapsf\.\w+|eightfold\.ai|jobvite\.com|recruitee\.com|rippling\.com|dayforcehcm\.com|ultipro\.com|paylocity\.com|adp\.com|linkedin\.com|joinhandshake\.com|jobright\.ai|simplify\.jobs|hiring\.cafe|hiringcafe\.com|google\.com|forms\.gle|notion\.site|github\.io|wellfound\.com|ycombinator\.com)$/i;
const TWO_PART_TLDS = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/i;

/** "https://careers.roblox.com/jobs/1" → "roblox.com" (or '' for ATS / aggregator hosts). */
export function employerDomain(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host || NOT_EMPLOYER.test(host)) return '';
  const labels = host.split('.');
  const keep = TWO_PART_TLDS.test(host) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** Best guess at a job's employer email domain. */
export function guessDomain(job) {
  return employerDomain(job?.company_url) || employerDomain(job?.url) || '';
}

const clean = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z]/g, '');

/** Fill a Hunter-style pattern ("{first}.{last}", "{f}{last}"…) for a person. */
export function emailFromPattern(pattern, fullName, domain) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!pattern || !domain || parts.length < 1) return '';
  const first = clean(parts[0]);
  const last = clean(parts.length > 1 ? parts[parts.length - 1] : '');
  if (!first || (/\{(last|l)\}/.test(pattern) && !last)) return '';
  const local = pattern
    .replace(/\{first\}/g, first)
    .replace(/\{last\}/g, last)
    .replace(/\{f\}/g, first[0] || '')
    .replace(/\{l\}/g, last[0] || '');
  return /^[a-z0-9._-]+$/.test(local) ? `${local}@${domain}` : '';
}

/** The formats most companies use, for when nothing better is known. */
export const COMMON_PATTERNS = ['{first}.{last}', '{f}{last}', '{first}'];

/** A short team phrase from the title, for "people on this team" searches. */
export function teamPhrase(title, tracks = []) {
  const t = String(title || '').toLowerCase();
  const table = [
    [/computer vision|perception|vision/, 'computer vision'],
    [/\bnlp\b|natural language|llm|language model/, 'NLP'],
    [/reinforcement learning|\brl\b|robot/, 'robotics learning'],
    [/data scien/, 'data science'],
    [/research scien|research intern|researcher/, 'research scientist'],
    [/applied scien/, 'applied scientist'],
    [/machine learning|\bml\b|\bai\b|deep learning/, 'machine learning'],
    [/quantitative research|quant research|\bqr\b/, 'quantitative research'],
    [/trad(er|ing)/, 'trading'],
    [/quantitative develop|quant dev|\bqd\b/, 'quantitative developer'],
    [/software|engineer|developer/, 'software engineering'],
  ];
  for (const [re, phrase] of table) if (re.test(t)) return phrase;
  return tracks.includes('quant') ? 'quantitative research' : 'machine learning';
}

const li = (keywords) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`;
const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** One-click searches the user opens in their own (signed-in) browser. */
export function outreachLinks(job, { school = 'northeastern-university', schoolName = 'Northeastern' } = {}) {
  const company = String(job?.company || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const team = teamPhrase(job?.title, job?.tracks);
  return [
    { label: `Recruiters at ${company}`, hint: 'university / campus / technical recruiters', url: li(`${company} university recruiter`) },
    { label: `${team[0].toUpperCase()}${team.slice(1)} people at ${company}`, hint: 'likely teammates or the hiring manager', url: li(`${company} ${team} manager`) },
    { label: `${schoolName} alumni at ${company}`, hint: 'best bet for a referral', url: `https://www.linkedin.com/school/${school}/people/?keywords=${encodeURIComponent(company)}` },
    { label: 'Recruiter profiles via Google', hint: 'public LinkedIn profiles, no sign-in', url: google(`site:linkedin.com/in "${company}" ("university recruiter" OR "campus recruiter" OR "technical recruiter" OR "talent acquisition")`) },
  ];
}

export function personLinks(person, company) {
  const c = String(company || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return { linkedin: li(`${person.name} ${c}`) };
}
