import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HIRINGCAFE_QUERIES,
  parseHiringCafeQueries,
  classifyHiringCafeJob,
} from '../lib/hiringcafe-query.mjs';

test('default HiringCafe queries cover AI/ML and quant internship searches', () => {
  assert.ok(DEFAULT_HIRINGCAFE_QUERIES.length >= 8);
  assert.ok(DEFAULT_HIRINGCAFE_QUERIES.every((q) => /intern$/.test(q)));
  assert.ok(DEFAULT_HIRINGCAFE_QUERIES.some((q) => /quantitative/.test(q)));
  assert.deepEqual(
    parseHiringCafeQueries(' machine learning intern | quant intern | machine learning intern | data science intern '),
    ['machine learning intern', 'quant intern', 'data science intern'],
  );
});

test("HC's commitment field counts as the internship signal", () => {
  assert.deepEqual(classifyHiringCafeJob({ title: 'Machine Learning Engineer', company: 'Acme', commitment: 'Full Time · Internship' })?.tracks, ['ai']);
  assert.equal(classifyHiringCafeJob({ title: 'Machine Learning Engineer', company: 'Acme', commitment: 'Full Time' }), null);
});

test('keeps AI/ML + quant internships, rejects the rest', () => {
  for (const title of [
    'Machine Learning Engineer Intern',
    'Data Science Intern - Summer 2027',
    'Quantitative Research Intern',
    'Research Scientist Intern, Computer Vision',
  ]) {
    assert.ok(classifyHiringCafeJob({ title, company: 'Acme', commitment: 'Internship' }), title);
  }
  for (const title of [
    'Software Engineering Intern',
    'Marketing Intern',
    'Mechanical Engineering Intern',
    'Senior Machine Learning Engineer',
  ]) {
    assert.equal(classifyHiringCafeJob({ title, company: 'Acme', commitment: 'Full Time' }), null, title);
  }
});
