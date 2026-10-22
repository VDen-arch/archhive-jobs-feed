# ArchHive public architecture job feed

Public employer vacancy metadata for https://archhive.design/jobs. This repository
contains no website source, database credentials, applicant data, or private records.

## Automatic updates

The GitHub workflow refreshes this feed daily at **06:17 Asia/Dubai (02:17 UTC)**.
GitHub may delay scheduled starts. No local computer needs to remain running.
Each run commits the feed, recording repository activity as well as update history.
The website checks the public feed at most hourly; no deployment is needed per update.

The workflow runs only while this dedicated repository is **public**. Standard
public GitHub-hosted runners are free. No external packages, paid APIs, secrets,
proxies, headless browsers, or uploaded build artifacts are used.

## Sources and safeguards

- SmartRecruiters public Posting API: AECOM and Egis Group.
- Greenhouse public Job Board API: Wight & Company.
- Lever public Postings API: TKDA, Hutker Architects and HUSH.
- Stores factual job metadata and original application links, not full advertisements.
- Includes building architecture, interiors, landscape, urban design and BIM roles.
  Software/IT architects, talent pools and general applications are excluded.
- Supports ArchHive's current country filters: India, UAE, UK, USA, Philippines,
  Singapore, Canada and Australia. Other locations are skipped, never guessed.
- Limits postings to 90 days old when the employer provides a posting date.
- Replaces each successful source snapshot: removed vacancies disappear on the next run.
- On a source failure, retains that source's previous jobs for at most 72 hours.
  Source-check timestamps are never advanced on failures. The website independently
  enforces this freshness limit, even if automation stops.
- Preserves first-seen and employer-posted dates separately. A refresh is not a new job.
- Source presence is not firm verification or a guarantee that a role is still available.
- Requests are bounded, timed out, and restricted to official public posting APIs.

Run locally: `node crawl.cjs`. Tests: `node --test test/*.test.cjs`.

References: [SmartRecruiters](https://developers.smartrecruiters.com/docs/endpoints),
[Greenhouse](https://docs.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api),
[GitHub free public runners](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
