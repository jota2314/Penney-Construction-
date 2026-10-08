import test from 'node:test';
import assert from 'node:assert/strict';
import { matchVendor, normalizeVendorName } from '../src/lib/quickbooks/vendor-match.ts';

// Real QuickBooks vendor names (10/8) that the app duplicated.
const qb = [
  ['225', 'Sullivan Tire', '2026-02-24'], ['654', 'Jackson Lumber', '2026-06-26'], ['512', 'Prestige Car Wash', '2026-02-24'],
  ['132', 'City of Peabody', '2026-02-24'], ['199', 'Cumberland Farms', '2026-02-24'], ['596', 'Anthropic, PBC', '2026-06-09'],
  ['38', 'Howard Clickstein', '2026-02-24'], ['128', "BJ's", '2026-02-24'], ['96', 'Lowes', '2026-02-24'],
  ['222', 'building center', '2026-02-24'], ['672', 'Building Center of Essex', '2026-07-21'], ['701', 'Building Center of Gloucester', '2026-08-02'],
  ['7xx', 'Consentino Plumbing & Heating Inc', '2026-02-24'], ['366', 'Town Line Foundations', '2026-02-24'], ['552', 'TBone Builders', '2026-02-24'],
  ['133', 'Shell', '2026-02-24'], ['94', 'Home Depot', '2026-02-24'], ['102', 'Gulf', '2026-02-24'], ['829', 'Gulf Danvers Express', '2026-09-23'],
  ['708', 'PureTraction Works Inc', '2026-08-05'], ['124', 'Town of Hamilton', '2026-02-24'], ['450', 'Town of Ipswich', '2026-02-24'],
  ['419', 'EZ Disposal Services', '2026-02-24'], ['262', 'E Z Disposal Inc.', '2026-02-24'], ['999', 'Old Name (deleted)', '2026-01-01'],
  ['400', 'MGL Tile Inc', '2026-02-24'], ['190', 'D L Services HVAC Inc', '2026-02-24'],
  ['103', 'Moynihan Lumber', '2026-02-24'], ['590', 'Chatgpt', '2026-06-01'], ['707', 'Boston Demolition & Removal', '2026-07-01'],
].map(([Id, DisplayName, t]) => ({ Id, DisplayName, Active: true, MetaData: { CreateTime: t } }));
const pick = name => matchVendor(name, qb)?.vendor.DisplayName ?? null;

test('scan spellings land on the existing vendor', () => {
  assert.equal(pick('SULLIVAN TIRE #14'), 'Sullivan Tire');
  assert.equal(pick('Sullivan Tire Peabody'), 'Sullivan Tire');
  assert.equal(pick('Jackson Lumber & Millwork Co. Inc.'), 'Jackson Lumber');
  assert.equal(pick('PRESTIGE CAR WASH PEABOD'), 'Prestige Car Wash');
  assert.equal(pick('City of Peabody, MA'), 'City of Peabody');
  assert.equal(pick('Cumberland Farms - Fuel'), 'Cumberland Farms');
  assert.equal(pick('ANTHROPIC'), 'Anthropic, PBC');
  assert.equal(pick("BJ's Wholesale Club"), "BJ's");
  assert.equal(pick("Lowe's Home Centers, LLC"), 'Lowes');
  assert.equal(pick("Lowe's"), 'Lowes');
  assert.equal(pick('Cosentino Plumbing and Heating Inc'), 'Consentino Plumbing & Heating Inc');
  assert.equal(pick('Townline Foundations'), 'Town Line Foundations');
  assert.equal(pick('T-Bone Builders'), 'TBone Builders');
  assert.equal(pick('Shell (Alliance Energy LLC)'), 'Shell');
  assert.equal(pick('Shell / Alliance Energy LLC'), 'Shell');
  assert.equal(pick('PureTraction Works Inc. (Thomas K. Puthanangady)'), 'PureTraction Works Inc');
  assert.equal(pick('Town of Hamilton (Building Department)'), 'Town of Hamilton');
  assert.equal(pick('EZ Disposal Service Inc'), 'EZ Disposal Services');
  assert.equal(pick('Mgl tile inc'), 'MGL Tile Inc');
  assert.equal(pick('The Home Depot'), 'Home Depot');
  assert.equal(pick('Moynihan North Reading Lumber Co. (Moynihan Lumber)'), 'Moynihan Lumber');
  assert.equal(pick('DL Services'), 'D L Services HVAC Inc');
  assert.equal(pick('OpenAI / ChatGPT'), 'Chatgpt');
  assert.equal(pick('Boston Demolition &amp; Removal'), 'Boston Demolition & Removal');
});

test('staff nicknames use their existing vendor', () => {
  assert.equal(pick('Howie Clickstein'), 'Howard Clickstein');
});

test('different businesses stay different', () => {
  assert.equal(pick('Building Center of Essex'), 'Building Center of Essex');
  assert.equal(pick('Building Center of Gloucester'), 'Building Center of Gloucester');
  assert.equal(pick('Gulf Danvers Express'), 'Gulf Danvers Express');
  assert.equal(pick('Town of Rowley'), null);
  assert.equal(pick('Town Line Wallpaper & Paint Inc.'), null);
  assert.equal(pick('Cosentino Tile'), null);
  assert.equal(pick('Old Name'), null, 'merged-away "(deleted)" vendors are never used');
  // Reviewer cases: generic one-word vendors and near-identical people.
  const people = [
    { Id: '1', DisplayName: 'Ace', Active: true }, { Id: '2', DisplayName: 'Joe', Active: true },
    { Id: '3', DisplayName: 'Luiz Santos', Active: true }, { Id: '4', DisplayName: 'Mike Silva', Active: true },
    { Id: '5', DisplayName: 'Shell', Active: true },
  ];
  assert.equal(matchVendor('Ace Electric Inc', people), null);
  assert.equal(matchVendor('Joe Ferreira Plumbing', people), null);
  assert.equal(matchVendor('Luis Santos', people), null);
  assert.equal(matchVendor('Mike Silvia', people), null);
  assert.equal(matchVendor('Shell Lumber Co', people), null);
});

test('oldest active record wins when QuickBooks already holds twins', () => {
  const twins = [
    { Id: '806', DisplayName: 'Amazon Business', Active: true, MetaData: { CreateTime: '2026-09-15' } },
    { Id: '791', DisplayName: 'Amazon Business (Amazon Services LLC)', Active: true, MetaData: { CreateTime: '2026-09-13' } },
    { Id: '5', DisplayName: 'AMAZON BUSINESS', Active: false, MetaData: { CreateTime: '2026-01-01' } },
  ];
  assert.equal(matchVendor('Amazon Business', twins)?.vendor.Id, '791');
});

test('normalization', () => {
  assert.equal(normalizeVendorName('The Rest Stop'), 'rest stop');
  assert.equal(normalizeVendorName('Citgo Danvers MA'), 'citgo danvers');
  assert.equal(normalizeVendorName('Fjm Construcción Inc'), 'fjm construccion');
});
