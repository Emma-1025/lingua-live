export interface SubtitleLine {
  id: string;
  spokenIndex: number;
  sourceText: string;
  zhText: string;
  status: 'partial' | 'final';
  untranslated: boolean;
  unrecognized: boolean;
  revisedAt?: number;
}
