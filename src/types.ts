export const LORE_CATEGORIES = [
  'Architectural Decision',
  'Design Requirement',
  'Future Improvement',
  'Tech Debt',
  'Bug Fix',
  'Onboarding/Explanation',
  'Open Question',
];

export interface LoreLocation {
  startLine: number;
  endLine: number;
  anchorText?: string;
  contextPreview?: string;
  lineHash?: string;
}

export interface LoreAuthor {
  name?: string;
  email?: string;
}

export interface LoreItem {
  id: string;
  state: 'active' | 'archived' | 'deleted';
  file: string;
  location: LoreLocation;
  summary: string;
  bodyMarkdown: string;
  references?: string[];
  tags?: string[];
  links?: string[];
  author?: LoreAuthor | string;
  createdAt: string;
  updatedAt: string;
  contentType?: string;
  isTrusted?: boolean;
  categories?: string[]; // New field
}

export type SavePayload = {
  command: 'save';
  id?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  summary?: string;
  body?: string;
  author?: string;
  tags?: string[];
  links?: string[];
  categories?: string[]; // New field
};

export type WebviewMessage = SavePayload | { command: 'cancel' } | { command: 'edit', id: string };

export interface LoreSnapshot {
  schemaVersion: number;
  fileMetadata: Record<string, unknown> & {
    workspace?: string;
    createdAt: string;
    lastUpdatedAt: string;
    lastUpdatedBy?: string;
    repoCommit?: string;
  };
  indexes: { tags: Record<string, number>; filesWithComments: number };
  items: LoreItem[];
}
