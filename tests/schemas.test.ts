import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCampaignSchema, formatZodIssues } from '../src/domain/schemas.js';
import { campaignInput } from './helpers.js';

function issuePaths(payload: unknown): string[] {
  const result = createCampaignSchema.safeParse(payload);
  assert.equal(result.success, false, 'esperava falha de validação');
  return formatZodIssues(result.error!).map((i) => i.path);
}

describe('createCampaignSchema', () => {
  it('aceita uma campanha completa', () => {
    const result = createCampaignSchema.safeParse(campaignInput());
    assert.equal(result.success, true);
  });

  it('assume status draft quando não informado', () => {
    const { status, ...withoutStatus } = campaignInput();
    void status;
    const result = createCampaignSchema.safeParse(withoutStatus);
    assert.equal(result.success, true);
    assert.equal(result.data?.status, 'draft');
  });

  it('exige data de término em orçamento lifetime', () => {
    const paths = issuePaths(
      campaignInput({
        budget: { mode: 'lifetime', amountMinor: 100000, currency: 'BRL' },
        schedule: { startAt: '2026-01-01T00:00:00.000Z' },
      }),
    );
    assert.ok(paths.includes('schedule.endAt'));
  });

  it('rejeita término anterior ao início', () => {
    const paths = issuePaths(
      campaignInput({
        schedule: { startAt: '2026-02-01T00:00:00.000Z', endAt: '2026-01-01T00:00:00.000Z' },
      }),
    );
    assert.ok(paths.includes('schedule.endAt'));
  });

  it('rejeita orçamento zero ou fracionado', () => {
    assert.ok(
      issuePaths(campaignInput({ budget: { mode: 'daily', amountMinor: 0, currency: 'BRL' } }))
        .includes('budget.amountMinor'),
    );
    assert.ok(
      issuePaths(campaignInput({ budget: { mode: 'daily', amountMinor: 10.5, currency: 'BRL' } }))
        .includes('budget.amountMinor'),
    );
  });

  it('rejeita moeda fora do padrão ISO-4217', () => {
    assert.ok(
      issuePaths(campaignInput({ budget: { mode: 'daily', amountMinor: 100, currency: 'reais' } }))
        .includes('budget.currency'),
    );
  });

  it('rejeita plataformas duplicadas e lista vazia', () => {
    assert.ok(issuePaths(campaignInput({ platforms: ['meta', 'meta'] })).includes('platforms'));
    assert.ok(issuePaths(campaignInput({ platforms: [] })).includes('platforms'));
  });

  it('rejeita país fora do formato alpha-2', () => {
    assert.ok(
      issuePaths(campaignInput({ targeting: { countries: ['Brasil'] } }))
        .some((p) => p.startsWith('targeting.countries')),
    );
  });

  it('rejeita faixa etária invertida', () => {
    assert.ok(
      issuePaths(campaignInput({ targeting: { countries: ['BR'], ageMin: 50, ageMax: 30 } }))
        .includes('targeting.ageMin'),
    );
  });
});
