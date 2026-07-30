export type BinderCheckpointTitleLang = 'ko' | 'en'

export interface BinderCheckpointTitleTranslations {
  ko?: string
  en?: string
}

export const binderCheckpointTitles: Readonly<
  Record<string, Readonly<Record<string, Readonly<BinderCheckpointTitleTranslations>>>>
>

export function checkpointTitle(
  setId: string,
  checkpointId: string,
  lang: BinderCheckpointTitleLang,
): string | undefined
