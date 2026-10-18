/**
 * classify.mjs — the one place that decides what counts as an AI/ML or Quant
 * internship. Every source (ATS sweeps, LinkedIn, Handshake, HiringCafe,
 * curated GitHub lists, JobRight, NextPlay) and the dashboard API run titles
 * through here, so a posting can't be "in" on one feed and "out" on another.
 *
 * Decision, in order:
 *   1. Hard negatives (recruiting, sales, marketing, PM, legal…) always lose,
 *      even when the title says "AI" — "AI Product Marketing Intern" is not
 *      an ML role.
 *   2. Must be an internship / co-op (title, or a structured hint from the
 *      source such as LinkedIn's job-type=Internship).
 *   3. Track(s):
 *        quant — quant/trading keywords, OR any technical intern role at a
 *                known quant firm ("Software Engineer Intern" at Jane Street).
 *        ai    — ML/AI keywords, OR a technical intern role at an AI-native
 *                company ("Software Engineer Intern" at Anthropic).
 *      A posting can be in both ("ML Research Intern" at Two Sigma).
 *
 * Zero dependencies so the Vercel API can import it unchanged.
 */

// ── Look-alike letters ──────────────────────────────────────────────
// Some boards swap Latin letters for look-alikes (Jane Street lists
// "ꓟachine ꓡearning ꓣesearcher" in Lisu) — presumably against scrapers, but
// it also hides the role from keyword search. Fold the common confusables
// (Unicode confusables.txt: Lisu, Cyrillic, Greek capitals/lowercase) back
// to ASCII before matching.
const CONFUSABLES = {
  'ꓐ': 'B', 'ꓑ': 'P', 'ꓓ': 'D', 'ꓔ': 'T', 'ꓖ': 'G', 'ꓗ': 'K', 'ꓙ': 'J', 'ꓚ': 'C', 'ꓜ': 'Z', 'ꓝ': 'F',
  'ꓟ': 'M', 'ꓠ': 'N', 'ꓡ': 'L', 'ꓢ': 'S', 'ꓣ': 'R', 'ꓦ': 'V', 'ꓧ': 'H', 'ꓪ': 'W', 'ꓫ': 'X', 'ꓬ': 'Y',
  'ꓮ': 'A', 'ꓰ': 'E', 'ꓲ': 'I', 'ꓳ': 'O', 'ꓴ': 'U',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'ο': 'o', 'ν': 'v',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

export function foldConfusables(s) {
  return String(s || '').replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]);
}

// ── Internship signal ───────────────────────────────────────────────

const INTERN_RE = new RegExp([
  String.raw`\binterns?\b`,
  String.raw`\binternships?\b`,
  String.raw`\bco-?ops?\b`,
  String.raw`\bapprentice(ship)?s?\b`,
  String.raw`\bstudent (researcher|engineer|developer|scientist|analyst|programmer|worker)s?\b`,
  String.raw`\bworking student\b`,
  String.raw`\bsummer (analyst|associate|scholar|fellow|engineer|researcher|program|undergraduate|student)s?\b`,
  String.raw`\b(ai|ml|research) residen(t|cy)\b`,
  String.raw`\bresidency program\b`,
  String.raw`\bfellowship\b`,
  String.raw`\bfellows program\b`,
  String.raw`\bsummer\s*'?(20)?2[5-9]\b`,
  String.raw`\b(20)?2[5-9]\s*summer\b`,
  String.raw`\bwinter\s*'?(20)?2[5-9]\b.*\b(program|analyst|engineer|research)`,
].join('|'), 'i');

// Titles that contain an intern word but describe a different job.
const NOT_INTERN_RE = /\b(intern(ship)?s? (program |recruit|coordinat|manag|lead|director)|(manager|director|head|coordinator|recruiter|lead)[, -]+(of )?(intern|internship|early career|university|campus))/i;

// ── Hard negatives: never a technical AI/ML/quant role ──────────────

const HARD_NEG_RE = new RegExp([
  String.raw`\brecruit(er|ers|ing|ment)?\b`,
  String.raw`\btalent (acquisition|partner|sourc)`,
  String.raw`\bhuman resources\b`, String.raw`\bhr\b`, String.raw`\bpeople (ops|operations|partner|team)\b`,
  String.raw`\bpayroll\b`, String.raw`\bbenefits\b`,
  String.raw`\bsales\b`, String.raw`\baccount (executive|manager|management)\b`, String.raw`\bbusiness development\b`,
  String.raw`\bmarketing\b`, String.raw`\bgrowth marketing\b`, String.raw`\bbrand\b`, String.raw`\bsocial media\b`,
  String.raw`\bcommunications?\b(?! (system|network|protocol|engineer|software))`,
  String.raw`\bpublic (relations|affairs|policy)\b`, String.raw`\bgovernment affairs\b`, String.raw`\bpolicy\b`,
  String.raw`\bcontent (writer|creator|strategist|marketing|moderat)`, String.raw`\bcopywrit`, String.raw`\bjournalis`, String.raw`\beditorial\b`,
  String.raw`\bvideo (editor|producer)\b`, String.raw`\bgraphic design`, String.raw`\bdesigner\b`, String.raw`\bux\b`, String.raw`\bui/ux\b`,
  String.raw`\blegal\b`, String.raw`\bparalegal\b`, String.raw`\blaw clerk\b`, String.raw`\bcompliance\b`, String.raw`\bcounsel\b`,
  String.raw`\baccounting\b`, String.raw`\baccountant\b`, String.raw`\baudit(or|ing)?\b`, String.raw`\btax\b`,
  String.raw`\bproduct manag`, String.raw`\bprogram manag`, String.raw`\bproject manag`, String.raw`\bproduct owner\b`,
  String.raw`\bproduct marketing\b`, String.raw`\bproduct operations\b`,
  String.raw`\bcustomer (success|support|service|experience)\b`, String.raw`\bsupport (specialist|representative)\b`,
  String.raw`\b(executive|administrative|office) assistant\b`, String.raw`\breceptionist\b`,
  String.raw`\bevents?\b(?! (driven|stream|sourcing|processing|data|pipeline|system))`,
  String.raw`\bfundrais`, String.raw`\bdevelopment (associate|officer)\b`, String.raw`\bphilanthrop`,
  String.raw`\bnurs(e|ing)\b`, String.raw`\bpharmac(y|ist)\b`, String.raw`\bphysician\b`, String.raw`\bdental\b`, String.raw`\bveterinar`,
  String.raw`\bteach(er|ing assistant)\b`, String.raw`\btutor\b`,
  String.raw`\bwarehouse\b`, String.raw`\bdriver\b`, String.raw`\bretail\b`, String.raw`\bcashier\b`, String.raw`\bbarista\b`, String.raw`\bcustodian\b`,
  String.raw`\breal estate\b`, String.raw`\binsurance agent\b`,
  String.raw`\bconsult(ant|ing)\b`, String.raw`\bstrategy (and|&) operations\b`, String.raw`\bchief of staff\b`,
  String.raw`\bcoo\b`, String.raw`\bchief operating\b`,
].join('|'), 'i');

// Soft negatives: non-software engineering disciplines. They don't block a
// title that explicitly says ML/AI/quant ("Mechanical Engineering Intern —
// Machine Learning"), but they do block company-list matches ("Mechanical
// Design Intern" at Figure is not an AI/ML role).
const SOFT_NEG_RE = /\b(mechanical|civil|structural|electrical|electronics?|hardware|asic|fpga|rtl|pcb|analog|rf|antenna|silicon|chip|semiconductor|manufactur\w*|industrial|chemical|chemistry|process engineer|materials?|mechatronics|thermal|optical|optics|photonics|aerospace|propulsion|avionics|supply chain|procurement|logistics|operations|facilities|construction|environmental|sustainability|quality (assurance|engineer|control)|test technician|technician|field service|maintenance|biology|biologist|lab (assistant|technician)|clinical|finance|financial analyst|investment banking|equity research|fp&a|business analyst|data analyst|bi analyst|analytics|operations research|wet lab)\b/i;

// Technical roles that make a company-list match plausible.
const TECH_ROLE_RE = /\b(software|engineer(ing)?|developer|programmer|research(er)?|scien(ce|tist)|data|machine learning|ml|ai|infra(structure)?|platform|systems?|backend|back-end|frontend|front-end|full[- ]?stack|security|devops|sre|compiler|kernel|gpu|cuda|performance|algorithm(s|ic)?|robotics|autonomy|technolog(y|ist)|swe|sde|quant(itative)?|trad(er|ing)|computational|math(ematic(s|al|ian))?|statistic(s|al|ian)?)\b/i;

// At a quant firm nearly every intern track is part of the quant pipeline
// (SWE, QR, QT, FPGA, "PhD Winter Intern", "Women in Trading" programs), so
// the gate there is "not a business/back-office role" rather than "names a
// technical function".
const QUANT_FIRM_NEG_RE = /\b(mechanical|civil|construction|facilities|workplace|office|supply chain|procurement|clinical|investment banking|equity research|sector analyst|investment analyst|venture capital|private equity|credit investing|fundamental|investor relations|investment services|strategy and product|procurement specialist|(equity|macro|credit|commodit(y|ies)|fundamental|investment|sector|business|financial|electricity|natural gas|energy) analyst|growth equity|value creation|risk and controls|corporate strategy|transformation|investor services|client services|corporate (development|finance|communications)|operations|middle office|back office|real estate)\b/i;

// ── Track keywords ──────────────────────────────────────────────────

const AI_RE = new RegExp([
  String.raw`\b(ai|a\.i\.|ml|aiml|genai|gen ai|llms?|vlms?|nlp|mlops|ml ops|cv|rl|rlhf)\b`,
  String.raw`\bai[/&-]ml\b`, String.raw`\bml[/&-]ai\b`, String.raw`\bai/data\b`,
  String.raw`machine[- ]learning`, String.raw`deep[- ]learning`, String.raw`artificial intelligence`,
  String.raw`data scien`, String.raw`decision scien`, String.raw`applied scien`,
  String.raw`computer vision`, String.raw`natural language`, String.raw`language models?`, String.raw`foundation models?`,
  String.raw`\bgenerative\b`, String.raw`reinforcement learning`, String.raw`\bneural\b`, String.raw`\btransformers?\b`,
  String.raw`\bdiffusion\b`, String.raw`multi-?modal`, String.raw`vision[- ]language`,
  String.raw`speech (recognition|synthesis|processing|ai|ml|models?|technolog)`, String.raw`\baudio (ml|ai)\b`,
  // Robot/vehicle perception — not consumer "run perception" or "brand perception" studies.
  String.raw`(?<!\b(run|running|brand|consumer|sensory|taste|customer|market|public|risk|product|user) )\bperception\b`, String.raw`\bautonom(y|ous)\b`, String.raw`robot(ic)? learning`, String.raw`embodied`,
  String.raw`motion planning`, String.raw`(behavior|trajectory) prediction`, String.raw`\bslam\b`, String.raw`\blearned\b`,
  String.raw`image (processing|analysis|recognition|understanding|generation)`, String.raw`\bvision (ai|ml|models?|systems?)\b`,
  String.raw`recommend(er|ation)s?( systems?)?\b`, String.raw`\brecsys\b`, String.raw`\branking\b`, String.raw`search relevance`, String.raw`personaliz`,
  String.raw`\b(ai|ml) (engineer|research|infra|platform|safety|systems?|compiler|accelerat|hardware|product|developer)`,
  String.raw`\binference\b`, String.raw`model (training|evaluation|serving|optimization)`, String.raw`\bevals?\b`,
  String.raw`\balignment\b`, String.raw`interpretability`, String.raw`\bagentic\b`, String.raw`\b(ai|llm) agents?\b`, String.raw`prompt engineer`,
  String.raw`data mining`, String.raw`predictive (model|analytics)`, String.raw`\bbioinformatic`, String.raw`computational (biology|linguistics|imaging)`,
  String.raw`\bgpu\b.*\b(kernel|ml|ai|training|inference)\b`, String.raw`\bcuda\b`,
].join('|'), 'i');

const QUANT_RE = new RegExp([
  String.raw`\bquants?\b`, String.raw`\bquantitative\b`,
  String.raw`\btrad(er|ers|ing)\b`, String.raw`algorithmic (trading|trader|developer|research|strateg)`, String.raw`\balgo\b`, String.raw`\balgorithm development\b`,
  String.raw`model (risk|validation)`, String.raw`\brisk (model|analytics|modell?ing|quant)`, String.raw`\bglobal markets\b`, String.raw`\bmarkets engineering\b`,
  // Goldman-style "Strats" — but not "Ops & Strat" (strategy).
  String.raw`market[- ]mak(er|ing)`, String.raw`\bstrats\b`, String.raw`\b(quant(itative)?|desk|securities) strats?\b`, String.raw`\bsystematic\b`,
  String.raw`statistical arbitrage`, String.raw`\bstat ?arb\b`, String.raw`\bhft\b`, String.raw`high[- ]frequency`,
  String.raw`\balpha (research|generation|capture|signals?)\b`,
  String.raw`portfolio (analytics|construction|research|optimization)`,
  String.raw`\bderivatives?\b`, String.raw`\bvolatility\b`, String.raw`\boptions (trading|research|pricing)\b`,
  String.raw`financial engineering`, String.raw`computational finance`, String.raw`mathematical finance`,
  String.raw`\b(qr|qt|qd)\b`,
].join('|'), 'i');

// "Research Scientist Intern" / "Research Intern" is ML at Meta or Microsoft
// Research, wet-lab work at a biotech. Generic research titles only count as
// AI/ML at AI firms, big-tech research orgs, or when a curated list says so.
const GENERIC_RESEARCH_RE = /\bresearch (scientist|science|engineer(ing)?|intern(ship)?|assistant|associate)\b|\bresearchers?\b|\bstudent researcher\b/i;

// ── Firm lists ──────────────────────────────────────────────────────
// Normalized (lowercase, punctuation stripped). Matched as whole-word
// prefixes of the normalized company name, so "Citadel Securities" and
// "Two Sigma Investments" both hit.

export const QUANT_FIRMS = [
  'jane street', 'citadel', 'citadel securities', 'two sigma', 'hudson river trading', 'hrt', 'wehrtyou',
  'jump trading', 'd e shaw', 'de shaw', 'deshaw', 'susquehanna', 'susquehanna international group', 'optiver',
  'imc trading', 'drw', 'five rings', 'akuna', 'akuna capital', 'virtu financial', 'tower research',
  'tower research capital', 'old mission', 'belvedere trading', 'wolverine trading', 'peak6',
  'millennium management', 'point72', 'cubist', 'bridgewater associates', 'aqr', 'aqr capital',
  'renaissance technologies', 'squarepoint', 'squarepoint capital', 'g research', 'xtx', 'xtx markets',
  'radix trading', 'headlands technologies', 'voleon', 'the voleon group', 'pdt partners', 'balyasny',
  'balyasny asset management', 'schonfeld', 'qube research', 'qube research technologies', 'qrt', 'flow traders',
  'chicago trading company', 'geneva trading', 'transmarket', 'group one trading', 'maven securities', 'vatic labs',
  'vatic investments', 'arrowstreet', 'arrowstreet capital', 'worldquant', 'man group', 'engineers gate',
  'graham capital', 'marshall wace', 'exoduspoint', 'jain global', 'tudor investment', 'verition', 'eisler capital',
  'davidson kempner', 'garda capital', 'hap capital', 'valkyrie trading', 'ansatz capital', 'quantlab', 'teza',
  'sun trading', 'allston trading', 'aquatic capital', 'eclipse trading', 'simplex trading', 'trexquant',
  'weiss multi strategy', 'millburn', 'blackedge', 'xr trading', 'hehmeyer', 'nine mile', 'tibra', 'quadrature',
  'capula', 'brevan howard', 'element capital', 'seven eight', 'dv trading', 'kershner', 'lime trading',
  'optiver us', 'citadel enterprise americas', 'oxford asset management', 'qminds', 'p schoenfeld',
  'jane street capital', 'two sigma investments', 'two sigma securities', 'de shaw research', 'gsa capital',
  'acadian asset management', 'numerai', 'hrt llc', 'capstone investment advisors', 'panagora', 'seven research',
  'the d e shaw group', 'citadel llc', 'jane street group', 'optiver holding', 'imc financial markets',
  'susquehanna international', 'hudson river trading llc', 'mako trading', 'campbell and company',
  'da vinci trading', 'walleye capital', 'hudson bay capital', 'winton group', 'volant trading', 'sculptor capital',
  'jump crypto', 'grasshopper asset management',
];

export const AI_FIRMS = [
  'openai', 'anthropic', 'google deepmind', 'deepmind', 'xai', 'x ai', 'scale ai', 'databricks', 'perplexity',
  'perplexity ai', 'mistral', 'mistral ai', 'hugging face', 'huggingface', 'character ai', 'pika', 'stability ai',
  'elevenlabs', 'eleven labs', 'suno', 'luma ai', 'black forest labs', 'midjourney', 'reka', 'essential ai', 'imbue',
  'liquid ai', 'reflection ai', 'thinking machines', 'thinking machines lab', 'world labs', 'periodic labs',
  'physical intelligence', 'skild ai', 'figure ai', '1x', '1x technologies', 'covariant', 'applied intuition',
  'waymo', 'aurora innovation', 'nuro', 'zoox', 'motional', 'wayve', 'glean', 'anysphere', 'cursor', 'cognition ai',
  'replit', 'decagon', 'hebbia', 'abridge', 'together ai', 'together computer', 'fireworks ai', 'groq', 'cerebras',
  'cerebras systems', 'sambanova', 'lambda labs', 'coreweave', 'modal labs', 'baseten', 'replicate', 'anyscale',
  'weights biases', 'wandb', 'pinecone', 'weaviate', 'langchain', 'llamaindex', 'contextual ai', 'nvidia',
  'safe superintelligence', 'isomorphic labs', 'insitro', 'tempus ai', 'genesis therapeutics', 'hippocratic ai',
  'ambience healthcare', 'pathai', 'viz ai', 'c3 ai', 'soundhound', 'snorkel ai', 'labelbox', 'arize', 'arize ai',
  'clarifai', 'datarobot', 'h2o ai', 'dataiku', 'moveworks', 'observe ai', 'cresta', 'typeface', 'synthesia',
  'heygen', 'krea', 'ideogram', 'cartesia', 'deepgram', 'assemblyai', 'hume ai', 'inworld', 'sakana ai',
  'nous research', 'allen institute for ai', 'ai2', 'mosaicml', 'cohere for ai', 'adept ai', 'inflection ai',
  'meta superintelligence', 'fal ai', 'mercor', 'surge ai', 'handshake ai', 'invisible technologies', 'tesla ai',
  'google research', 'microsoft research', 'nvidia research', 'apple ml', 'harvey ai', 'paige ai', 'galileo ai',
  'writer ai', 'runway ml', 'runwayml', 'recursion pharmaceuticals', 'jasper ai', 'cohere ai', 'poolside ai',
  'magic dev',
];

// Big-tech orgs whose research interns are overwhelmingly ML.
export const BIG_TECH_RESEARCH = [
  'meta', 'facebook', 'google', 'alphabet', 'microsoft', 'apple', 'amazon', 'aws', 'amazon web services', 'adobe',
  'netflix', 'snap', 'tiktok', 'bytedance', 'spotify', 'uber', 'linkedin', 'salesforce', 'ibm', 'intel', 'qualcomm',
  'samsung', 'sony', 'baidu', 'alibaba', 'tencent', 'pinterest', 'airbnb', 'roblox', 'reddit', 'yahoo', 'ebay', 'intuit',
  'servicenow', 'cisco', 'tesla', 'nokia bell labs', 'bell labs', 'toyota research institute', 'honda research institute',
  'bosch', 'siemens', 'adobe research', 'disney research', 'mitsubishi electric research', 'merl', 'sri international',
  'jpmorgan', 'jpmorgan chase', 'jp morgan chase', 'capital one', 'bloomberg', 'visa', 'mastercard', 'paypal',
];

const normalizeName = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(inc|llc|l l c|lp|l p|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|the)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function compileFirmMatcher(list) {
  const names = [...new Set(list.map(normalizeName).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`^(?:${names.join('|')})(?: |$)`);
  return (company) => {
    const n = normalizeName(company);
    return Boolean(n) && re.test(n);
  };
}

export const isQuantFirm = compileFirmMatcher(QUANT_FIRMS);
const isAiFirmListed = compileFirmMatcher(AI_FIRMS);
export const isBigTechResearch = compileFirmMatcher(BIG_TECH_RESEARCH);

/** AI-native heuristic: listed firm, or a name like "Viz.ai" / "Scale AI". */
export function isAiFirm(company) {
  const raw = String(company || '');
  if (isAiFirmListed(raw)) return true;
  return /(\.ai\b|\bai$|\bai labs?\b|\b(ai|ml) (inc|corp|labs?|research)\b)/i.test(raw.trim());
}

// ── Season / degree ─────────────────────────────────────────────────

const SEASON_RE = /\b(summer|fall|autumn|spring|winter)\b[\s,'’/-]*(?:of\s*)?(?:20)?(2[5-9])\b|\b(?:20)?(2[5-9])\b[\s,'’/-]*(summer|fall|autumn|spring|winter)\b/i;
const SEASON_ORDER = { winter: 0, spring: 1, summer: 2, fall: 3 };

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "Summer 2027" / "Fall 2026" / "" — from the title, else from a terms[] hint. */
export function seasonOf(title, terms) {
  const m = String(title || '').match(SEASON_RE);
  if (m) {
    const season = (m[1] || m[4] || '').toLowerCase().replace('autumn', 'fall');
    const yy = m[2] || m[3];
    if (season && yy) return `${titleCase(season)} 20${yy}`;
  }
  const list = Array.isArray(terms) ? terms : (terms ? [terms] : []);
  const parsed = list
    .map((t) => String(t || '').trim())
    .map((t) => t.match(/^(summer|fall|autumn|spring|winter)\s+(20\d\d)$/i))
    .filter(Boolean)
    .map((m) => ({ season: titleCase(m[1].replace(/autumn/i, 'fall')), year: Number(m[2]) }))
    .sort((a, b) => a.year - b.year || SEASON_ORDER[a.season.toLowerCase()] - SEASON_ORDER[b.season.toLowerCase()]);
  return parsed.length ? `${parsed[parsed.length - 1].season} ${parsed[parsed.length - 1].year}` : '';
}

/** "PhD" when the role is explicitly PhD-only, "MS"/"BS" when stated, else "". */
export function degreeOf(title, degrees) {
  const t = String(title || '');
  if (/\b(ph\.?\s?d|doctoral|doctorate)\b/i.test(t) && !/\b(bs|ms|bachelor|master|undergrad)/i.test(t)) return 'PhD';
  if (/\b(master'?s?|m\.?s\.?|graduate student|grad student)\b/i.test(t)) return 'MS';
  if (/\b(undergrad(uate)?|bachelor'?s?|b\.?s\.?)\b/i.test(t)) return 'BS';
  const list = Array.isArray(degrees) ? degrees.map((d) => String(d).toLowerCase()) : [];
  if (list.length === 1 && /phd|doctor/.test(list[0])) return 'PhD';
  return '';
}

// Approximate start month for each term. A term is "past" a month after it
// starts — Summer 2026 roles still marked active in October aren't hiring.
const SEASON_START_MONTH = { Winter: 0, Spring: 2, Summer: 5, Fall: 8 };

export function seasonIsPast(season, now = Date.now()) {
  const m = String(season || '').match(/^(Winter|Spring|Summer|Fall) (\d{4})$/);
  if (!m) return false;
  const start = Date.UTC(Number(m[2]), SEASON_START_MONTH[m[1]], 1);
  return start + 31 * 86400000 < now;
}

export function isCoop(title, commitment) {
  return /\bco-?ops?\b/i.test(`${title || ''} ${commitment || ''}`);
}

// ── Main entry points ───────────────────────────────────────────────

/**
 * @param {string} title
 * @param {{ internHint?: boolean, commitment?: string }} [opts]
 *   internHint: the source itself says this is an internship (LinkedIn
 *   job-type filter, Handshake job type, Simplify's intern list…).
 */
export function isInternRole(title, { internHint = false, commitment = '' } = {}) {
  const t = String(title || '').replace(/\bco-?op city\b/gi, ' ');
  if (!t.trim() || NOT_INTERN_RE.test(t)) return false;
  if (INTERN_RE.test(t)) return true;
  if (/\bintern(ship)?\b|\bco-?op\b/i.test(String(commitment || ''))) return true;
  return Boolean(internHint);
}

/**
 * Classify one posting. Returns null when it's not an AI/ML or Quant internship.
 *
 * @param {{ title: string, company?: string, category?: string,
 *           internHint?: boolean, commitment?: string, terms?: string[],
 *           degrees?: string[] }} job
 *   category: a source-level hint — 'quant' | 'ai' (tracked-board category,
 *   SpeedyApply section, NW FinTech list): treated like a firm-level match.
 *   listCategory: a weaker hint (Simplify's broad "AI/ML/Data" label) that
 *   only resolves generic research titles.
 */
export function classifyJob(job) {
  const title = foldConfusables(job?.title).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  // "Sales and Trading" is a markets division (quant-adjacent), not a sales job.
  if (HARD_NEG_RE.test(title.replace(/\bsales\s*(and|&)\s*trading\b/gi, 'trading'))) return null;
  if (!isInternRole(title, job)) return null;

  const company = String(job?.company || '');
  const category = String(job?.category || '').toLowerCase();
  const aiKw = AI_RE.test(title);
  const quantKw = QUANT_RE.test(title);
  const techRole = TECH_ROLE_RE.test(title) && !SOFT_NEG_RE.test(title);

  const quantFirm = category === 'quant' || isQuantFirm(company);
  const aiFirm = category === 'ai' || isAiFirm(company);

  const tracks = [];
  if (quantKw || (quantFirm && !QUANT_FIRM_NEG_RE.test(title))) {
    tracks.push('quant');
  }
  const researchAi = GENERIC_RESEARCH_RE.test(title) && !SOFT_NEG_RE.test(title) && !quantKw
    && (aiFirm || isBigTechResearch(company) || job?.listCategory === 'ai');
  // An AI-firm / AI-list hint never turns an explicitly quant title into AI/ML
  // ("Quantitative Trading Intern" filed under an AI list's general section).
  if (aiKw || (aiFirm && techRole && !quantKw) || researchAi) tracks.push('ai');
  if (!tracks.length) return null;

  return {
    tracks,
    season: seasonOf(title, job?.terms),
    degree: degreeOf(title, job?.degrees),
    coop: isCoop(title, job?.commitment),
  };
}

/** Title-only gate for the ATS scanners (portals.yml title_filter.mode: classify). */
export function titlePasses(title, ctx = {}) {
  return classifyJob({ title, company: ctx.company, category: ctx.category }) !== null;
}
