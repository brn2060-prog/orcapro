import type { Ad } from '../domain/ad.js';
import type { AdSet } from '../domain/adSet.js';
import type { Campaign } from '../domain/campaign.js';
import { InMemoryRepository, JsonFileRepository, type Repository } from './repository.js';

export type CampaignRepository = Repository<Campaign>;
export type AdSetRepository = Repository<AdSet>;
export type AdRepository = Repository<Ad>;

export class InMemoryCampaignRepository extends InMemoryRepository<Campaign> {}
export class JsonFileCampaignRepository extends JsonFileRepository<Campaign> {}

export class InMemoryAdSetRepository extends InMemoryRepository<AdSet> {}
export class JsonFileAdSetRepository extends JsonFileRepository<AdSet> {}

export class InMemoryAdRepository extends InMemoryRepository<Ad> {}
export class JsonFileAdRepository extends JsonFileRepository<Ad> {}

export type { Repository } from './repository.js';
