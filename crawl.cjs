// Public employer posting APIs only. No browser, proxy, paid API, credentials,
// applicant information, or access to ArchHive's private repository/database.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sources = require('./sources.json');
const DAY = 86400000;
const MAX_AGE = 90 * DAY;
const STALE_AFTER = 72 * 60 * 60 * 1000;
const API_HOSTS = new Set(['api.smartrecruiters.com', 'boards-api.greenhouse.io', 'api.lever.co']);
const JOB_HOSTS = new Set(['jobs.smartrecruiters.com', 'jobs.lever.co', 'job-boards.greenhouse.io', 'boards.greenhouse.io']);
const COUNTRIES = { us: 'USA', gb: 'UK', ae: 'UAE', in: 'India', ph: 'Philippines', sg: 'Singapore', ca: 'Canada', au: 'Australia' };
const RELEVANT = /\b(architect(?:s|ure|ural)?|interior(?:s)?|landscape|urban (?:design(?:er)?|plan(?:ner|ning)?)|bim|revit|architectural visuali[sz]|3d visuali[sz])\b/i;
const EXCLUDED = /\b(software|cloud|enterprise|solution[s]?|data|network|security|it|naval)\s+(?:\w+\s+)?architect|\b(talent pool|expression[s]? of interest|general application|open submission|networking event)\b/i;
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const iso = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const relevant = title => RELEVANT.test(title) && !EXCLUDED.test(title);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, fetcher = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !API_HOSTS.has(parsed.hostname)) throw new Error('Unapproved API host');
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'User-Agent': 'ArchHive-JobsFeed/1.0 (+https://archhive.design/jobs)' } });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) { await pause(2000); continue; }
        if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > 10_000_000) throw new Error('Source response too large');
        const body = await response.text();
        if (body.length > 10_000_000) throw new Error('Source response too large');
        return JSON.parse(body);
    }
}

function employment(value, title) {
    const t = text(value);
    if (/\bintern|trainee|apprentice/i.test(`${title} ${t}`)) return 'Internship';
    if (/freelance/i.test(`${title} ${t}`)) return 'Freelance';
    if (/contract|temporary|fixed.term/i.test(t)) return 'Contract';
    if (/part.?time/i.test(t)) return 'Part-time';
    if (/full.?time|permanent/i.test(t)) return 'Full-time';
    return null;
}

function tags(title, mode) {
    const categories = [];
    if (/interior/i.test(title)) categories.push('Interior Design');
    if (/landscape/i.test(title)) categories.push('Landscape');
    if (/urban|town plan/i.test(title)) categories.push('Urban Planning');
    if (/bim|revit/i.test(title)) categories.push('BIM');
    if (/visuali[sz]/i.test(title)) categories.push('Visualization');
    if (!categories.length) categories.push('Architecture');
    if (mode) categories.push(mode);
    return categories;
}

function normalize(row, source, now = Date.now()) {
    const title = text(row.title);
    if (!relevant(title) || !row.url || !row.key) return null;
    let url;
    try { url = new URL(row.url); } catch { return null; }
    if (url.protocol !== 'https:' || !JOB_HOSTS.has(url.hostname) || url.username || url.password) return null;
    url.search = ''; url.hash = '';
    const posted = iso(row.posted);
    if (posted && (Date.parse(posted) > now + DAY || now - Date.parse(posted) > MAX_AGE)) return null;
    if (row.deadline && (!iso(row.deadline) || Date.parse(row.deadline) <= now)) return null;
    const country = row.country || source.country;
    if (!Object.values(COUNTRIES).includes(country)) return null;
    return {
        id: `crawl-${source.id}-${createHash('sha256').update(String(row.key)).digest('hex').slice(0, 16)}`,
        title: title.slice(0, 240), firm_name: source.name, location: text(row.location).slice(0, 240) || country,
        country, type: employment(row.type, title), description: null,
        apply_url: url.href, prize_or_salary: text(row.salary).slice(0, 160) || null,
        posted_at: posted, created_at: new Date(now).toISOString(),
        source: source.id, source_name: source.name, source_checked_at: new Date(now).toISOString(),
        availability: 'listed-on-source', verified: false, match_tags: tags(title, row.mode),
    };
}

async function readSource(source, now = Date.now(), fetcher = fetch) {
    const records = new Map();
    if (source.kind === 'smartrecruiters') {
        for (const term of ['architect', 'interior', 'landscape', 'urban', 'BIM']) {
            for (let page = 0; page < 3; page++) {
                const offset = page * 100;
                const data = await request(`https://api.smartrecruiters.com/v1/companies/${source.board}/postings?q=${term}&limit=100&offset=${offset}`, fetcher);
                if (!Array.isArray(data.content) || !Number.isFinite(Number(data.totalFound))) throw new Error('Changed SmartRecruiters response');
                for (const job of data.content) {
                    if (!job.id || typeof job.name !== 'string') throw new Error('Invalid SmartRecruiters posting');
                    const location = job.location || {};
                    const country = COUNTRIES[String(location.country).toLowerCase()];
                    const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    records.set(String(job.id), { key: job.id, title: job.name, country,
                        location: location.fullLocation || [location.city, location.region, country].filter(Boolean).join(', '),
                        url: `https://jobs.smartrecruiters.com/${source.board}/${job.id}-${slug}`,
                        type: job.typeOfEmployment?.label, posted: job.releasedDate,
                        mode: location.remote ? 'Remote' : location.hybrid ? 'Hybrid' : null });
                }
                if (offset + data.content.length >= Number(data.totalFound) || !data.content.length) break;
                await pause(250);
            }
            await pause(250);
        }
    } else if (source.kind === 'greenhouse') {
        const data = await request(`https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs`, fetcher);
        if (!Array.isArray(data.jobs)) throw new Error('Changed Greenhouse response');
        for (const job of data.jobs) records.set(String(job.id), { key: job.id, title: job.title, location: job.location?.name, url: job.absolute_url, posted: job.first_published, deadline: job.application_deadline });
    } else if (source.kind === 'lever') {
        const data = await request(`https://api.lever.co/v0/postings/${source.board}?mode=json`, fetcher);
        if (!Array.isArray(data)) throw new Error('Changed Lever response');
        for (const job of data) {
            const salary = job.salaryRange;
            const pay = salary && Number.isFinite(salary.min) && Number.isFinite(salary.max)
                ? `${salary.currency || ''} ${salary.min.toLocaleString('en-US')}–${salary.max.toLocaleString('en-US')}${salary.interval ? ` / ${salary.interval}` : ''}` : null;
            records.set(String(job.id), { key: job.id, title: job.text, location: job.categories?.allLocations?.join(' / ') || job.categories?.location, url: job.hostedUrl, type: job.categories?.commitment, posted: job.createdAt, mode: ({ remote: 'Remote', hybrid: 'Hybrid', 'on-site': 'On-site' })[job.workplaceType], salary: pay });
        }
    } else throw new Error('Unsupported source');
    return [...records.values()].map(row => normalize(row, source, now)).filter(Boolean).slice(0, 500);
}

async function crawl({ output = path.join(__dirname, 'feed.json'), now = Date.now(), definitions = sources, fetcher = fetch } = {}) {
    let previous = { jobs: [] };
    try { previous = JSON.parse(fs.readFileSync(output, 'utf8')); } catch { /* First run. */ }
    const previousJobs = Array.isArray(previous.jobs) ? previous.jobs : [];
    const firstSeen = new Map(previousJobs.map(job => [job.id, job.created_at]));
    const jobs = [], health = [];
    for (const source of definitions) {
        try {
            const found = await readSource(source, now, fetcher);
            for (const job of found) { const first = firstSeen.get(job.id); if (iso(first) && Date.parse(first) <= now) job.created_at = first; jobs.push(job); }
            health.push({ id: source.id, name: source.name, status: 'ok', count: found.length, checked_at: new Date(now).toISOString() });
            console.log(`${source.name}: ${found.length} current architecture/design roles`);
        } catch (error) {
            // A provider outage is not evidence that its vacancies closed. Retain
            // its last successful snapshot for at most 72h without re-dating it.
            const retained = previousJobs.filter(job => job.source === source.id && now - Date.parse(job.source_checked_at) <= STALE_AFTER && Date.parse(job.source_checked_at) <= now && (!job.posted_at || now - Date.parse(job.posted_at) <= MAX_AGE));
            jobs.push(...retained);
            health.push({ id: source.id, name: source.name, status: 'error', count: retained.length, error: error.message });
            console.error(`${source.name}: ${error.message} (${retained.length} temporarily retained)`);
        }
    }
    const unique = [...new Map(jobs.map(job => [job.apply_url, job])).values()].sort((a, b) => Date.parse(b.posted_at || b.created_at) - Date.parse(a.posted_at || a.created_at));
    const result = { version: 1, generated_at: new Date(now).toISOString(), sources: health, jobs: unique.slice(0, 1500) };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output + '.tmp', JSON.stringify(result, null, 2) + '\n');
    fs.renameSync(output + '.tmp', output);
    console.log(`Published snapshot: ${result.jobs.length} roles; ${health.filter(source => source.status === 'ok').length}/${health.length} sources healthy`);
    return result;
}

if (require.main === module) crawl().then(result => { if (!result.sources.some(source => source.status === 'ok')) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { normalize, relevant, readSource, crawl, request };
