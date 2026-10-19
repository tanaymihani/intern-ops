import test from 'node:test';
import assert from 'node:assert/strict';
import { employerDomain, guessDomain, emailFromPattern, teamPhrase, outreachLinks } from '../public/people-core.js';

test('employer domain from careers / company URLs, never from job boards', () => {
  assert.equal(employerDomain('https://careers.roblox.com/jobs/8159857?gh_jid=8159857'), 'roblox.com');
  assert.equal(employerDomain('https://www.janestreet.com/join-jane-street/position/1/'), 'janestreet.com');
  assert.equal(employerDomain('https://www.imc.com/us/imc-investments/'), 'imc.com');
  assert.equal(employerDomain('https://jobs.example.co.uk/x'), 'example.co.uk');
  assert.equal(employerDomain('https://job-boards.greenhouse.io/figma/jobs/1'), '');
  assert.equal(employerDomain('https://www.linkedin.com/jobs/view/1/'), '');
  assert.equal(employerDomain('https://nvidia.wd5.myworkdayjobs.com/x'), '');
  assert.equal(employerDomain('not a url'), '');
  assert.equal(guessDomain({ company_url: 'https://www.sig.com', url: 'https://careers-sig.icims.com/jobs/1/job' }), 'sig.com');
});

test('email from a Hunter-style pattern', () => {
  assert.equal(emailFromPattern('{first}.{last}', 'Ada Lovelace', 'example.com'), 'ada.lovelace@example.com');
  assert.equal(emailFromPattern('{f}{last}', 'José  Álvarez-Ruiz', 'example.com'), 'jalvarezruiz@example.com');
  assert.equal(emailFromPattern('{first}', 'Grace Hopper', 'example.com'), 'grace@example.com');
  assert.equal(emailFromPattern('{first}{l}', 'Alan Mathison Turing', 'example.com'), 'alant@example.com');
  assert.equal(emailFromPattern('{first}.{last}', 'Cher', 'example.com'), '');
  assert.equal(emailFromPattern('', 'Ada Lovelace', 'example.com'), '');
});

test('team phrase and outreach links', () => {
  assert.equal(teamPhrase('Computer Vision Engineering Intern'), 'computer vision');
  assert.equal(teamPhrase('Quantitative Trader Intern'), 'trading');
  assert.equal(teamPhrase('Software Engineer Intern', ['quant']), 'software engineering');
  const links = outreachLinks({ company: 'Susquehanna International Group (SIG)', title: 'Quantitative Research Intern', tracks: ['quant'] });
  assert.equal(links.length, 4);
  assert.ok(links[2].url.startsWith('https://www.linkedin.com/school/northeastern-university/people/?keywords=Susquehanna'));
  assert.ok(!links[0].url.includes('(SIG)'));
});
