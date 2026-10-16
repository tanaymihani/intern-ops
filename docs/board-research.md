# Board research notes (2026-10-15)

Background for `portals.yml` → `tracked_companies` (the entries tagged
`category: quant | ai`). Every listed board was verified with a live request
to its public ATS API. This file keeps what *didn't* fit there: firms on
custom career sites, the public JSON endpoints behind some of them (Jane
Street, SIG and D. E. Shaw are scraped by `fetch-quant-sites.mjs`), and slugs
that look right but belong to a different company.

```text
=====================================================================================
NOT MAPPED TO A SUPPORTED ATS (greenhouse/ashby/lever/workday/smartrecruiters/workable)
All endpoints below were requested with plain GETs on 2026-10-15 unless marked otherwise.
=====================================================================================

---- Custom sites that expose a usable public JSON (or JSON-in-HTML) listing ----

Jane Street (also on Greenhouse above; this is the richer feed)
  GET https://www.janestreet.com/jobs/main.json
  -> JSON array (226 items) of {id, position, category, availability, city, team, duration,
     overview(HTML), min_salary, max_salary}. id == Greenhouse job id;
     apply URL = https://www.janestreet.com/join-jane-street/apply/{id}.
     Intern flag is availability == "Summer Internship" (42 today: 17 NYC, 13 LDN, 10 HKG, 2 SGP);
     titles never say "intern", so title filters miss them. One title uses Unicode look-alike
     letters ("ꓟachine ꓡearning ꓣesearcher") - normalize/transliterate before keyword matching.

D. E. Shaw  (careers page: https://www.deshaw.com/careers/choose-your-path)
  GET https://www.deshaw.com/careers/choose-your-path  -> HTML; parse <script id="__NEXT_DATA__">
  -> props.pageProps.internships[] (12 today, all "... Intern ... Summer 2027"),
     props.pageProps.regularJobs[] (94), props.pageProps.internalJobs[] (90).
     Each item = {data:{id, displayName, jobUrl, hireType, department{name}, jobCategory[], ...}};
     detail URL = https://www.deshaw.com/careers/{jobUrl lower-cased}.

Susquehanna (SIG)  (careers page: https://careers.sig.com/jobs ; iCIMS "Jibe" front end)
  GET https://careers.sig.com/api/jobs?page=1&limit=100            (add &keywords=intern to filter)
  -> {"jobs":[{"data":{req_id, title, city, state, country_code, categories:[{name}], tags1..tags5,
     posted_date, apply_url (careers-sig.icims.com)}}], "totalCount": 288, ...}
     Category "Interns + Co-ops" = 67 jobs today; 17 of the first 100 titles are intern-titled.

AMD  (careers page: https://careers.amd.com/careers-home/jobs ; same iCIMS "Jibe" platform as SIG)
  GET https://careers.amd.com/api/jobs?page=1&limit=100&keywords=intern
  -> same shape as SIG; totalCount 114 for keywords=intern (98 of first 100 intern-titled);
     1281 jobs total without keywords.

Millennium Management  (careers page: https://www.mlp.com/careers/ -> Eightfold)
  GET https://mlp.eightfold.ai/api/apply/v2/jobs?domain=mlp.com&start=0&num=10   (&query=intern)
  -> {"positions":[{id, name, location, locations[], department, t_create, t_update,
     canonicalPositionUrl, ...}], "count": 224}. Page size is fixed at 10 -> paginate with start=.
     (Old Workday tenant mlp.wd5.myworkdayjobs.com/mlpcareers returns 0 jobs.)

Netflix  (Eightfold)
  GET https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&start=0&num=10&query=intern
  -> same Eightfold v2 shape; count 414 total, 4 for query=intern today.

Microsoft  (Eightfold "PCSX"; the v2 API above answers 403 "Not authorized for PCSX")
  GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=intern&location=&start=0
  -> {"status":200,"data":{"positions":[{id, displayJobId, name, locations[], standardizedLocations[],
     postedTs, ...}], "count": 101}}  (10 per page; paginate with start=)

Qualcomm  (Eightfold "PCSX", same as Microsoft)
  GET https://qualcomm.eightfold.ai/api/pcsx/search?domain=qualcomm.com&query=intern&location=&start=0
  -> same shape; count 95 for query=intern.

Amazon
  GET https://www.amazon.jobs/en/search.json?base_query=intern&normalized_country_code%5B%5D=USA&result_limit=100&offset=0
  -> {"hits": 76, "jobs":[{id_icims, title, normalized_location, job_path, posted_date, is_intern,
     university_job, ...}]}

Apple
  GET https://jobs.apple.com/en-us/search?search=intern&location=united-states-USA&page=1  -> HTML;
  parse window.__staticRouterHydrationData = JSON.parse("...") ->
  loaderData.search.searchResults[20] {positionId, postingTitle, locations[], postingDate, ...},
  loaderData.search.totalRecords (1351 for this search; Apple's keyword search is fuzzy).

Google / Google DeepMind  (DeepMind now lists only on Google Careers)
  GET https://www.google.com/about/careers/applications/jobs/results?company=DeepMind&q=intern&page=1
  -> HTML; parse AF_initDataCallback({key:'ds:1', data:[[jobs...], null, total, pageSize]}).
     Each job tuple: [0]=id, [1]=title, [9]=[[location,...],...]. DeepMind: 108 jobs, 0 for q=intern.

JPMorgan Chase  (Oracle Recruiting Cloud)
  GET https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1001,limit=25,offset=0,keyword=intern,sortBy=RELEVANCY
  -> {"items":[{"TotalJobsCount": N, "requisitionList":[{Id, Title, PrimaryLocation, PostedDate, ...}]}]}
     job URL = https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/{Id}

Goldman Sachs  (front end https://higher.gs.com is a Next.js app; backing Oracle Recruiting Cloud site CX_2001)
  GET https://hdpc.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_2001,limit=25,offset=0,keyword=intern
  -> same Oracle shape; TotalJobsCount 465 for keyword=intern (titles like
     "2027 | Americas | Houston | Investment Banking | Summer Associate").

Uber  (Oracle Recruiting Cloud)
  GET https://iaziqy.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=UberCareers,limit=25,offset=0,keyword=intern
  -> same Oracle shape; TotalJobsCount 304. (Omit expand=... and requisitionList comes back empty.)

Groq  (Gem ATS; careers page https://groq.com/careers -> https://jobs.gem.com/groq)
  GET https://api.gem.com/job_board/v0/groq/job_posts/
  -> JSON array of Greenhouse-like posts {absolute_url, title, location{name}, content, ...}

Wolverine Trading  (Pinpoint ATS; careers page https://www.wolve.com/open-positions)
  GET https://wolve.pinpointhq.com/postings.json
  -> {"data":[{id, title, location{name}, url, ...}]}; 20 jobs today, 0 intern-titled.

Optiver (already covered by Greenhouse optiverus; this is a mirror)
  GET https://www.optiver.com/en/api/v1/jobs -> {"items":[{title, location, experience, domain, href}], "totalCount":162}
XTX Markets (mirror of Greenhouse xtxmarketstechnologies)
  GET https://api.xtxcareers.com/jobs.json -> {"jobs":[Greenhouse job objects]}

---- Custom / unsupported systems with no public JSON found ----

Citadel                 https://www.citadel.com/careers/open-opportunities/  - custom site behind a Cloudflare
                        challenge (403 "Just a moment..." to curl); job URLs look like
                        https://www.citadel.com/careers/details/{slug}/
Citadel Securities      https://www.citadelsecurities.com/careers/open-opportunities/ - same Cloudflare-gated custom site
Two Sigma (+ Two Sigma Securities)  https://careers.twosigma.com/careers/OpenRoles - Avature portal, HTML only,
                        10 rows/page (paginate ?jobOffset=10,20,...); interns under /careers/InternshipsAndEarlyCareers;
                        detail URLs /careers/JobDetail/{slug}/{id}
Bloomberg               https://bloomberg.avature.net/careers - Avature, HTML only (SearchJobsData/ is a map feed, empty)
Renaissance Technologies https://www.rentec.com/Careers.action - static page, no ATS
Balyasny (BAM)          https://www.bamfunds.com/careers - applications on Salesforce Experience Cloud
                        (https://bambusdev.my.site.com/s/); no public listing JSON found
Brevan Howard           https://careers.brevanhoward.com/gb/en/home - Phenom People
Quantlab                https://www.quantlab.com/careers.html - Jobvite iframe (main site Cloudflare-gated)
Interactive Brokers     https://jobs.dayforcehcm.com/en-US/ibgllc/CANDIDATEPORTAL - Dayforce
XR Trading              https://recruiting.paylocity.com/recruiting/jobs/All/5c109104-7c4d-415c-9ee4-54e3af55f9e7/XR-Trading-LLC
                        - Paylocity; its feed https://recruiting.paylocity.com/recruiting/v2/api/feed/jobs/5c109104-7c4d-415c-9ee4-54e3af55f9e7
                        returned {"jobs":[]} today
IBM                     https://www.ibm.com/careers/search (client-rendered; careers.ibm.com is Avature-style)
Tesla                   https://www.tesla.com/careers/search/ - Akamai 403 to non-browser clients (also cua-api)
Meta                    https://www.metacareers.com/jobs - 400 to non-browser clients; GraphQL needs page tokens
Hudson Bay Capital      https://www.hudsonbaycapital.com/careers - email only (careers@hudsonbaycapital.com)
Hap Capital             https://www.hapcapital.com/career/ - Lever "hap-capital" exists but has 0 postings
Hippocratic AI          https://hippocraticai.com/careers/ - WordPress page, ATS not identified
Contextual AI           https://contextual.ai/careers - roles rendered client-side, ATS not identified
Augment Code            https://www.augmentcode.com/careers - roles rendered client-side, ATS not identified
Group One Trading       grouponetrading.com is now a parked domain; current careers site not found
Eisler Capital, Allston Trading, Sun Trading, Kershner Trading, Lime Trading, Millburn, GTS, Hehmeyer
                        - careers sites unreachable / no ATS links found; not mapped
Cubist Systematic Strategies - posts on the Point72 Greenhouse board (point72) above
Covariant, Adept (teams absorbed by Amazon), Replicate (acquired by Cloudflare) - no active boards

---- Valid supported-ATS boards with 0 open jobs today (re-check later) ----
Sculptor Capital        https://sculptor.wd12.myworkdayjobs.com/Sculptor_External_Career_Site  (0 jobs)
Tibra Capital           https://apply.workable.com/tibra-capital-1  (0 jobs; linked from tibra.com/careers)
Essential AI            https://jobs.ashbyhq.com/essentialai  (0 jobs; linked from essential.ai/careers)
Hap Capital             https://jobs.lever.co/hap-capital  (0 jobs)
Man Group (old Workday) https://mangroupplc.wd3.myworkdayjobs.com/Man_Group_Careers (1 stale job; use Greenhouse mangroup)
Mistral (old Lever)     https://jobs.lever.co/mistral (0 jobs; moved to Ashby mistral.ai)

---- Look-alike slugs that are NOT the firm (do not use) ----
greenhouse/headlandsresearch = Headlands Research (clinical trials), not Headlands Technologies
ashby/runway = Runway (business-planning SaaS), not Runway ML (use runway-ml)
ashby/nomic = Nomic Bio, not Nomic AI ; ashby/circle = Circle (community SaaS), not Circle Internet Financial
greenhouse/cfm = an HVAC distributor, not Capital Fund Management
ashby/jump, ashby/maven = unrelated startups, not Jump Trading / Maven Securities
greenhouse/optiverprivate = Optiver internal/test board (contains "(Test)" postings)
greenhouse/flowtradersuspartners = single "Math Test Free Shot" campus-partner posting
greenhouse/kalshi = older Kalshi board (postings from 2025); current board is ashby/kalshi
greenhouse/coreweaveu = CoreWeave Europe (EMEA roles), not a university board

---- Verified today but left out as off-category (not quant/AI-focused) - add if you want them ----
Morningstar                              workday         https://morningstar.wd5.myworkdayjobs.com/Americas  (18 jobs, 0 intern-titled*)
Broadridge                               workday         https://broadridge.wd5.myworkdayjobs.com/Careers  (318 jobs, 3 intern-titled*)
State Street                             workday         https://statestreet.wd1.myworkdayjobs.com/Global  (1281 jobs, 0 intern-titled*)
Northern Trust                           workday         https://ntrs.wd1.myworkdayjobs.com/northerntrust  (618 jobs, 0 intern-titled*)
TD Bank / TD Securities                  workday         https://td.wd3.myworkdayjobs.com/TD_Bank_Careers  (1731 jobs, 18 intern-titled*)
RBC (all roles)                          workday         https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1  (849 jobs, 28 intern-titled*)
Capital One                              workday         https://capitalone.wd12.myworkdayjobs.com/Capital_One  (1967 jobs, 0 intern-titled*)
Raymond James (early careers)            workday         https://raymondjames.wd1.myworkdayjobs.com/RaymondJamesEarlyCareers  (7 jobs, 2 intern-titled*)
Visa (early careers)                     workday         https://visa.wd5.myworkdayjobs.com/Visa_Early_Careers  (31 jobs, 22 intern-titled*)
Mastercard (campus)                      workday         https://mastercard.wd1.myworkdayjobs.com/Campus  (52 jobs, 26 intern-titled*)
PayPal                                   workday         https://paypal.wd1.myworkdayjobs.com/jobs  (336 jobs, 0 intern-titled*)
Citi (early-careers events)              workday         https://citi.wd5.myworkdayjobs.com/citi_early_careers_events_site  (22 jobs, 0 intern-titled*)
Workday (all roles)                      workday         https://workday.wd5.myworkdayjobs.com/Workday  (400 jobs, 1 intern-titled*)
Salesforce Research                      workday         https://salesforce.wd12.myworkdayjobs.com/Salesforce_Research  (1 jobs, 0 intern-titled*)
Bosch                                    smartrecruiters https://jobs.smartrecruiters.com/BoschGroup  (5058 jobs, 432 intern-titled*)
SoFi                                     greenhouse      https://job-boards.greenhouse.io/sofi  (51 jobs, 1 intern-titled*)
Addepar                                  greenhouse      https://job-boards.greenhouse.io/addepar1  (113 jobs, 0 intern-titled*)
Ripple                                   greenhouse      https://job-boards.greenhouse.io/ripple  (108 jobs, 0 intern-titled*)
Wealthfront                              lever           https://jobs.lever.co/wealthfront  (24 jobs, 0 intern-titled*)
Betterment                               greenhouse      https://job-boards.greenhouse.io/betterment  (24 jobs, 0 intern-titled*)
Asana                                    greenhouse      https://job-boards.greenhouse.io/asana  (106 jobs, 0 intern-titled*)
Twilio                                   greenhouse      https://job-boards.greenhouse.io/twilio  (137 jobs, 0 intern-titled*)
GitLab                                   greenhouse      https://job-boards.greenhouse.io/gitlab  (219 jobs, 0 intern-titled*)
Elastic                                  greenhouse      https://job-boards.greenhouse.io/elastic  (380 jobs, 0 intern-titled*)
Chime                                    greenhouse      https://job-boards.greenhouse.io/chime  (72 jobs, 0 intern-titled*)
Dropbox                                  greenhouse      https://job-boards.greenhouse.io/dropbox  (21 jobs, 0 intern-titled*)
Airtable                                 greenhouse      https://job-boards.greenhouse.io/airtable  (5 jobs, 0 intern-titled*)
Pantera Capital                          greenhouse      https://job-boards.greenhouse.io/panteracapitalcareers  (6 jobs, 0 intern-titled*)
Sands Capital                            greenhouse      https://job-boards.greenhouse.io/sandscapitalmanagementllc  (1 jobs, 0 intern-titled*)
DRW (French-language Montreal postings)  greenhouse      https://job-boards.greenhouse.io/drwfr  (11 jobs, 0 intern-titled*)
Kalshi (older Greenhouse board)          greenhouse      https://job-boards.greenhouse.io/kalshi  (28 jobs, 0 intern-titled*)
  * intern counts in this block come from the discovery pass (Workday: first 300 'intern' search results only)
```
