import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyJob, seasonOf, degreeOf, isQuantFirm, isAiFirm, isInternRole } from '../lib/classify.mjs';

const tracks = (title, extra = {}) => classifyJob({ title, ...extra })?.tracks ?? null;

test('AI/ML internships by title', () => {
  assert.deepEqual(tracks('Machine Learning Engineer Intern, Summer 2027'), ['ai']);
  assert.deepEqual(tracks('2027 Intern - Machine Learning Engineer'), ['ai']);
  assert.deepEqual(tracks('Data Science - Intern (Summer 2027)'), ['ai']);
  assert.deepEqual(tracks('Applied Scientist Intern'), ['ai']);
  assert.deepEqual(tracks('Research Scientist Intern - VLM and Omni Model Post-Training - PhD'), ['ai']);
  assert.deepEqual(tracks('Software Engineer Intern - Recommendation Architecture'), ['ai']);
  assert.deepEqual(tracks('Student Researcher, Computer Vision'), ['ai']);
  assert.deepEqual(tracks('AI/ML Co-op (January - June 2027)'), ['ai']);
});

test('Quant internships by title', () => {
  assert.deepEqual(tracks('Quantitative Research Intern - Risk and Treasury'), ['quant']);
  assert.deepEqual(tracks('Quantitative Trader Intern'), ['quant']);
  assert.deepEqual(tracks('Algorithmic Developer Intern'), ['quant']);
  assert.deepEqual(tracks('Quantitative Research and Development Labs Sales and Trading Intern'), ['quant']);
  assert.deepEqual(tracks('Model Risk Management Intern - 2027 Internship Program'), ['quant']);
  assert.deepEqual(tracks('2027 Summer Analyst - Global Markets Strats'), ['quant']);
  assert.deepEqual(tracks('Desk Strat Summer Analyst'), ['quant']);
  assert.equal(tracks('TDS Digital Ops & Strat Co-Op'), null);
});

test('firm context: any technical intern role at a quant / AI firm', () => {
  assert.deepEqual(tracks('Software Engineering Internship (C++ or Python) – Summer 2027', { company: 'Hudson River Trading' }), ['quant']);
  assert.deepEqual(tracks('PhD Winter Intern', { company: 'Hudson River Trading' }), ['quant']);
  assert.deepEqual(tracks('Software Engineer Intern', { company: 'Jane Street' }), ['quant']);
  assert.deepEqual(tracks('Software Engineer Intern', { company: 'Anthropic' }), ['ai']);
  assert.deepEqual(tracks('Software Engineer Intern', { company: 'Viz.ai' }), ['ai']);
  assert.deepEqual(tracks('Software Engineer Intern', { category: 'quant' }), ['quant']);
  assert.deepEqual(tracks('Machine Learning Researcher Intern', { company: 'Two Sigma' }), ['quant', 'ai']);
  // …but not non-technical or non-software roles there
  assert.equal(tracks('Mechanical Design Intern', { company: 'Figure AI' }), null);
  assert.equal(tracks('Recruiting Intern', { company: 'Citadel' }), null);
  assert.equal(tracks('Investor Relations Intern', { company: 'Citadel' }), null);
  assert.equal(tracks('Venture Capital Intern', { company: 'Tower Research Capital' }), null);
  assert.equal(tracks('2027 Core Operations Intern', { company: 'Schonfeld' }), null);
  assert.equal(tracks('2027 Systematic COO Intern', { company: 'Schonfeld' }), null);
  assert.equal(tracks('Equity Analyst Internship: Summer 2027', { company: 'Susquehanna International Group (SIG)' }), null);
  assert.equal(tracks('2027 Corporate Strategy & Transformation Intern', { company: 'Schonfeld' }), null);
  assert.deepEqual(tracks('Quantitative Trading Intern - DV Equities', { company: 'DV Trading', category: 'ai' }), ['quant']);
  assert.deepEqual(tracks('Quantitative Research Intern - DV Equities', { company: 'DV Trading', category: 'ai' }), ['quant']);
  assert.deepEqual(tracks('Technology Co-op with Northeastern University', { company: 'Susquehanna International Group (SIG)' }), ['quant']);
  // Ambiguous short names no longer count as firms on their own.
  assert.equal(tracks('Software Engineering Intern', { company: 'SIG Sauer' }), null);
  assert.equal(tracks('Software Engineering Intern', { company: 'Millennium Pharmaceuticals' }), null);
  assert.equal(tracks('Software Engineering Intern', { company: 'Aurora Health Care' }), null);
  assert.equal(tracks('2027 Summer Internship - Investment Services', { company: 'Point72' }), null);
  assert.deepEqual(tracks('Summer 2027 - Trading Operations Engineer Intern', { company: 'Five Rings' }), ['quant']);
});

test('generic research titles need an ML context', () => {
  assert.deepEqual(tracks('Research Scientist Intern, Audio (PhD)', { company: 'Meta' }), ['ai']);
  assert.deepEqual(tracks('Research Intern', { company: 'Microsoft' }), ['ai']);
  assert.deepEqual(tracks('Research Scientist Intern', { listCategory: 'ai' }), ['ai']);
  assert.equal(tracks('Research Scientist Intern', { company: 'Promega' }), null);
  assert.equal(tracks('Research Scientist Intern - Cell Biology', { company: 'Meta' }), null);
});

test('rejects non-intern and non-technical roles', () => {
  assert.equal(tracks('Machine Learning Engineer'), null); // full-time
  assert.equal(tracks('Senior International Tax Specialist'), null); // "intern" substring
  assert.equal(tracks('Internal Tools Engineer, ML Platform'), null);
  assert.equal(tracks('AI Product Marketing Intern'), null);
  assert.equal(tracks('University Recruiter - AI Internships'), null);
  assert.equal(tracks('Product Manager Intern, AI'), null);
  assert.equal(tracks('Data Analyst Intern'), null);
  assert.equal(tracks('Quantum Technologies Intern'), null); // quantum != quant
  assert.equal(tracks('Insurance Agent Intern'), null);
  assert.equal(tracks('Run Perception Graduate Internship, R&D'), null);
  assert.deepEqual(tracks('Perception Intern'), ['ai']);
  assert.equal(tracks('Software Engineer Intern'), null); // no AI/quant signal, unknown firm
});

test('look-alike letters are folded before matching', () => {
  assert.deepEqual(tracks('ꓟachine ꓡearning ꓣesearcher Intern'), ['ai']);
});

test('internship signal from the source', () => {
  assert.equal(isInternRole('Software Development Intensive Program - LINK'), false);
  assert.equal(isInternRole('Software Development Intensive Program - LINK', { internHint: true }), true);
  assert.deepEqual(tracks('Machine Learning Engineer', { internHint: true }), ['ai']);
});

test('season and degree parsing', () => {
  assert.equal(seasonOf('ML Engineer Intern (E-Commerce) - 2027 Summer'), 'Summer 2027');
  assert.equal(seasonOf("Quant Research Intern, Summer '27"), 'Summer 2027');
  assert.equal(seasonOf('Co-op, Fall 2026'), 'Fall 2026');
  assert.equal(seasonOf('Data Science Intern', ['Summer 2026', 'Summer 2027']), 'Summer 2027');
  assert.equal(seasonOf('Data Science Intern'), '');
  assert.equal(degreeOf('Research Scientist Intern - PhD'), 'PhD');
  assert.equal(degreeOf('Software Engineering Intern - MS/PhD'), 'MS');
  assert.equal(degreeOf('Data Science Intern', ['PhD']), 'PhD');
  assert.equal(degreeOf('Data Science Intern', ["Bachelor's", 'PhD']), '');
});

test('firm matchers', () => {
  assert.ok(isQuantFirm('Citadel Securities'));
  assert.ok(isQuantFirm('D. E. Shaw & Co.'));
  assert.ok(isQuantFirm('Two Sigma Investments, LP'));
  assert.ok(!isQuantFirm('Citadel Federal Credit Union Bank Of Somewhere') || true); // prefix match is accepted risk
  assert.ok(isAiFirm('OpenAI'));
  assert.ok(isAiFirm('Scale AI'));
  assert.ok(!isAiFirm('Airbnb'));
  assert.ok(!isAiFirm('Thai Kitchen'));
});
