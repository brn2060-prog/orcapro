import { z } from 'zod';
import { AD_FORMATS, CALL_TO_ACTIONS } from './ad.js';
import {
  BUDGET_MODES,
  CAMPAIGN_STATUSES,
  GENDERS,
  OBJECTIVES,
  PLATFORMS,
} from './campaign.js';

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'data ISO-8601 inválida' });

const budgetSchema = z.object({
  mode: z.enum(BUDGET_MODES),
  amountMinor: z
    .number()
    .int('use unidades menores inteiras (centavos)')
    .positive('o orçamento precisa ser maior que zero'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'use o código ISO-4217 em maiúsculas, ex.: BRL')
    .default('BRL'),
});

const scheduleSchema = z.object({
  startAt: isoDateTime,
  endAt: isoDateTime.optional(),
});

const targetingSchema = z.object({
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'use o código ISO-3166-1 alpha-2, ex.: BR'))
    .min(1, 'informe ao menos um país'),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
  genders: z.array(z.enum(GENDERS)).optional(),
  interests: z.array(z.string().min(1)).optional(),
});

const platformsSchema = z
  .array(z.enum(PLATFORMS))
  .min(1, 'informe ao menos uma plataforma')
  .refine((list) => new Set(list).size === list.length, {
    message: 'plataformas duplicadas',
  });

/**
 * Regras que envolvem mais de um campo. Aplicadas tanto na criação quanto na
 * atualização, sempre sobre o objeto já mesclado.
 */
function checkCrossFieldRules(
  value: {
    budget?: { mode?: string } | undefined;
    schedule?: { startAt?: string; endAt?: string } | undefined;
    targeting?: { ageMin?: number; ageMax?: number } | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const { budget, schedule, targeting } = value;

  if (schedule?.startAt && schedule.endAt) {
    if (Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule', 'endAt'],
        message: 'endAt precisa ser posterior a startAt',
      });
    }
  }

  if (budget?.mode === 'lifetime' && schedule && !schedule.endAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'endAt'],
      message: 'orçamento lifetime exige uma data de término',
    });
  }

  if (
    targeting?.ageMin !== undefined &&
    targeting.ageMax !== undefined &&
    targeting.ageMin > targeting.ageMax
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['targeting', 'ageMin'],
      message: 'ageMin não pode ser maior que ageMax',
    });
  }
}

/** Campos da campanha sem as regras cruzadas, para poder ser estendido. */
const campaignObject = z.object({
  name: z.string().min(1, 'informe o nome da campanha').max(255),
  objective: z.enum(OBJECTIVES),
  status: z.enum(CAMPAIGN_STATUSES).default('draft'),
  budget: budgetSchema,
  schedule: scheduleSchema,
  targeting: targetingSchema,
  platforms: platformsSchema,
});

export const createCampaignSchema = campaignObject.superRefine(checkCrossFieldRules);

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    objective: z.enum(OBJECTIVES).optional(),
    budget: budgetSchema.optional(),
    schedule: scheduleSchema.optional(),
    targeting: targetingSchema.optional(),
    platforms: platformsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'informe ao menos um campo para atualizar',
  });

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

/**
 * Revalida as regras cruzadas depois de mesclar o patch na campanha existente —
 * um patch só de `budget` pode invalidar o `schedule` que já estava salvo.
 */
export const mergedCampaignSchema = z
  .object({
    budget: budgetSchema,
    schedule: scheduleSchema,
    targeting: targetingSchema,
  })
  .superRefine(checkCrossFieldRules);

export const publishSchema = z.object({
  /** Subconjunto de `campaign.platforms`. Omitido = todas. */
  platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
});

export const setStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'archived']),
});

export const listQuerySchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  platform: z.enum(PLATFORMS).optional(),
});

// --- conjuntos de anúncios ---

const adSetObject = z.object({
  name: z.string().min(1, 'informe o nome do conjunto').max(255),
  status: z.enum(CAMPAIGN_STATUSES).default('draft'),
  /** Omitido = herda o orçamento da campanha (CBO na Meta). */
  budget: budgetSchema.optional(),
  /** Omitida = herda a janela da campanha. */
  schedule: scheduleSchema.optional(),
  targeting: targetingSchema,
  bidAmountMinor: z.number().int().positive().optional(),
});

export const createAdSetSchema = adSetObject.superRefine(checkCrossFieldRules);

export type CreateAdSetInput = z.infer<typeof createAdSetSchema>;

export const updateAdSetSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    budget: budgetSchema.optional(),
    schedule: scheduleSchema.optional(),
    targeting: targetingSchema.optional(),
    bidAmountMinor: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'informe ao menos um campo para atualizar',
  });

export type UpdateAdSetInput = z.infer<typeof updateAdSetSchema>;

// --- anúncios ---

const creativeSchema = z
  .object({
    format: z.enum(AD_FORMATS),
    headlines: z
      .array(z.string().min(1).max(120))
      .min(1, 'informe ao menos um título')
      .max(15, 'no máximo 15 títulos'),
    descriptions: z
      .array(z.string().min(1).max(240))
      .min(1, 'informe ao menos uma descrição')
      .max(4, 'no máximo 4 descrições'),
    primaryText: z.string().min(1).max(2000).optional(),
    landingPageUrl: z
      .string()
      .refine((value) => /^https?:\/\//.test(value), { message: 'use uma URL http(s)' }),
    callToAction: z.enum(CALL_TO_ACTIONS),
    imageUrl: z
      .string()
      .refine((value) => /^https?:\/\//.test(value), { message: 'use uma URL http(s)' })
      .optional(),
    videoIds: z.partialRecord(z.enum(PLATFORMS), z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.format === 'single_image' && !value.imageUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['imageUrl'],
        message: 'formato single_image exige imageUrl',
      });
    }
    if (value.format === 'single_video' && !value.videoIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['videoIds'],
        message: 'formato single_video exige videoIds com o ID do vídeo em cada plataforma',
      });
    }
  });

export const createAdSchema = z.object({
  name: z.string().min(1, 'informe o nome do anúncio').max(255),
  status: z.enum(CAMPAIGN_STATUSES).default('draft'),
  creative: creativeSchema,
});

export type CreateAdInput = z.infer<typeof createAdSchema>;

export const updateAdSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    creative: creativeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'informe ao menos um campo para atualizar',
  });

export type UpdateAdInput = z.infer<typeof updateAdSchema>;

// --- árvore completa em um arquivo ---

/**
 * O que o CLI aceita em `publicar`: a campanha com seus conjuntos e anúncios
 * aninhados, para subir tudo de uma vez.
 */
export const campaignFileSchema = campaignObject
  .extend({
    adSets: z
      .array(adSetObject.extend({ ads: z.array(createAdSchema).optional() }))
      .optional(),
  })
  .superRefine(checkCrossFieldRules);

export type CampaignFileInput = z.infer<typeof campaignFileSchema>;

/** Converte um ZodError em um payload de erro estável para a API. */
export function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(raiz)',
    message: issue.message,
  }));
}
