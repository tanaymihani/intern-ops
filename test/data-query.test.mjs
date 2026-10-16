import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DATA_QUERIES,
  acceptDataJob,
} from '../lib/data-query.mjs';

test('default data queries cover the requested data-role set', () => {
  const lower = DEFAULT_DATA_QUERIES.map((q) => q.toLowerCase());
  for (const expected of [
    'data engineer',
    'data analyst',
    'data scientist',
    'etl developer',
    'power bi developer',
    'database administrator',
    'business intelligence',
    'analytics engineer',
    'machine learning engineer',
    'data warehouse engineer',
  ]) {
    assert.ok(lower.some((q) => q.includes(expected)), `missing query covering "${expected}"`);
  }
});

test('accepts core data-role titles', () => {
  for (const title of [
    'Data Engineer II',
    'Data Analyst',
    'Data Scientist, Marketing Analytics',
    'ETL Developer',
    'Power BI Developer',
    'Database Administrator',
    'Business Intelligence Engineer',
    'Business/BI Analyst',
    'Analytics Engineer',
    'Machine Learning Engineer',
    'AI/ML Engineer',
    'Data Warehouse Engineer',
    'Product Analyst',
  ]) {
    assert.equal(acceptDataJob({ title }), true, `should accept "${title}"`);
  }
});

test('rejects unrelated non-data engineering titles', () => {
  for (const title of ['Civil Engineer', 'Mechanical Engineer', 'Frontend Engineer', 'iOS Engineer']) {
    assert.equal(acceptDataJob({ title }), false, `should reject "${title}"`);
  }
});

test('rejects senior/management and physical-engineering titles like the software filter', () => {
  for (const title of ['Senior Data Engineer', 'Director of Analytics', 'Staff Data Scientist', 'Civil Data Engineer']) {
    assert.equal(acceptDataJob({ title }), false, `should reject "${title}"`);
  }
});

test('baseline bypass still works the same way as the software filter', () => {
  assert.equal(acceptDataJob({ title: 'Totally Unrelated Role' }, { baseline: true }), true);
});
