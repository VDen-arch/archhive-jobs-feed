const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize, relevant, crawl, request } = require('../crawl.cjs');
const now = Date.parse('2026-10-22T02:17:00Z');
const day = 86400000;
const source = { id: 'studio', kind: 'greenhouse', name: 'Example Studio', board: 'example', country: 'USA' };
const row = { key: '123', title: 'Project Architect', url: 'https://job-boards.greenhouse.io/example/jobs/123', location: 'Chicago, USA', posted: now - day };

test('keeps built-environment roles, excludes software architects and evergreen pools', () => {
    for (const title of ['Architect', 'Architectural Designer', 'Interior Designer', 'BIM Coordinator', 'Landscape Architect', 'Urban Planner', '2027 Intern - Architecture']) assert.equal(relevant(title), true, title);
    for (const title of ['Software Architect', 'Senior Cloud Solutions Architect', 'Enterprise Architect', 'Data Architect', 'Accountant', 'Architecture Talent Pool', 'Architect - Networking Event']) assert.equal(relevant(title), false, title);
});
test('rejects stale, future and expired vacancies without inventing dates or verification', () => {
    assert.equal(normalize({ ...row, posted: now - 91 * day }, source, now), null);
    assert.equal(normalize({ ...row, posted: now + 3 * day }, source, now), null);
    assert.equal(normalize({ ...row, deadline: new Date(now - day).toISOString() }, source, now), null);
    const job = normalize({ ...row, posted: undefined }, source, now);
    assert.equal(job.posted_at, null);
    assert.equal(job.verified, false);
    assert.equal(job.source_checked_at, new Date(now).toISOString());
});
test('rejects non-employer links, unsafe URLs, and unsupported countries', async () => {
    for (const url of ['https://evil.example/jobs/1', 'javascript:alert(1)', 'https://user:password@jobs.lever.co/studio/123', 'broken']) assert.equal(normalize({ ...row, url }, source, now), null);
    assert.equal(normalize({ ...row, country: 'France' }, source, now), null);
    await assert.rejects(request('http://127.0.0.1/private'), /Unapproved/);
});
test('preserves first-seen dates and removes listings absent from a successful refresh', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archhive-jobs-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const output = path.join(dir, 'feed.json');
    const fetcher = async () => new Response(JSON.stringify({ jobs: [{ id: 123, title: row.title, absolute_url: row.url, first_published: new Date(now - day).toISOString(), location: { name: row.location } }] }));
    const first = await crawl({ output, now, definitions: [source], fetcher });
    const second = await crawl({ output, now: now + day, definitions: [source], fetcher });
    assert.equal(second.jobs[0].created_at, first.jobs[0].created_at);
    assert.notEqual(second.jobs[0].source_checked_at, first.jobs[0].source_checked_at);
    const empty = await crawl({ output, now: now + day, definitions: [source], fetcher: async () => new Response('{"jobs":[]}') });
    assert.deepEqual(empty.jobs, []);
});
test('retains failed-source results for 72h without re-dating them, then expires them', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archhive-jobs-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const output = path.join(dir, 'feed.json');
    const job = normalize(row, source, now);
    fs.writeFileSync(output, JSON.stringify({ jobs: [job] }));
    const fetcher = async () => { throw new Error('offline'); };
    const retained = await crawl({ output, now: now + day, definitions: [source], fetcher });
    assert.equal(retained.jobs[0].source_checked_at, job.source_checked_at);
    assert.equal(retained.sources[0].status, 'error');
    const expired = await crawl({ output, now: now + 4 * day, definitions: [source], fetcher });
    assert.deepEqual(expired.jobs, []);
});
