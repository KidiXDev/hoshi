export type MossCatalogKind = 'character' | 'style';
export type MossCatalogSort = 'count' | 'az' | 'newest' | 'random';

export interface MossCatalogEntry {
  id: string;
  name: string;
  copyright: string;
  kind: MossCatalogKind;
  tags: string;
  caption: string;
  prompt: string;
  sourceCount: number;
  gender: string[];
  hairColor: string[];
  hairLength: string[];
  eyeColor: string[];
  outfit: string[];
  category: string | null;
  addedAt: string;
}

export interface MossCatalogQuery {
  query?: string;
  kind?: MossCatalogKind;
  id?: string;
  copyright?: string;
  gender?: string;
  hairColor?: string;
  hairLength?: string;
  eyeColor?: string;
  outfit?: string;
  category?: string;
  sort?: MossCatalogSort;
  seed?: number;
  page?: number;
  pageSize?: number;
}

export interface MossCatalogPage {
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  results: MossCatalogEntry[];
}

export interface MossCatalogFacetValue {
  value: string;
  label: string;
  count: number;
}

export interface MossCatalogFacets {
  characters: number;
  styles: number;
  copyright: MossCatalogFacetValue[];
  gender: MossCatalogFacetValue[];
  hairColor: MossCatalogFacetValue[];
  hairLength: MossCatalogFacetValue[];
  eyeColor: MossCatalogFacetValue[];
  outfit: MossCatalogFacetValue[];
  category: MossCatalogFacetValue[];
}
