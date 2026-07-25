import { getLang } from './i18n/lang'

export interface BinderBook {
  id: string
  issue: string
  file: string
  pages: number
}

const koBinderBooks: BinderBook[] = [
  { id: 'spl-00-01', issue: '00-01', file: 'spl-binder-00-01.pdf', pages: 172 },
  { id: 'spl-02', issue: '02', file: 'spl-binder-02.pdf', pages: 64 },
  { id: 'spl-03', issue: '03', file: 'spl-binder-03.pdf', pages: 64 },
  { id: 'spl-04', issue: '04', file: 'spl-binder-04.pdf', pages: 64 },
  { id: 'spl-05', issue: '05', file: 'spl-binder-05.pdf', pages: 66 },
  { id: 'spl-06', issue: '06', file: 'spl-binder-06.pdf', pages: 64 },
  { id: 'spl-07', issue: '07', file: 'spl-binder-07.pdf', pages: 64 },
  { id: 'spl-08', issue: '08', file: 'spl-binder-08.pdf', pages: 66 },
  { id: 'spl-09', issue: '09', file: 'spl-binder-09.pdf', pages: 66 },
  { id: 'spl-10', issue: '10', file: 'spl-binder-10.pdf', pages: 66 },
  { id: 'spl-11', issue: '11', file: 'spl-binder-11.pdf', pages: 66 },
  { id: 'spl-12', issue: '12', file: 'spl-binder-12.pdf', pages: 66 },
  { id: 'spl-13', issue: '13', file: 'spl-binder-13.pdf', pages: 66 },
  { id: 'spl-14', issue: '14', file: 'spl-binder-14.pdf', pages: 66 },
  { id: 'spl-15', issue: '15', file: 'spl-binder-15.pdf', pages: 66 },
  { id: 'spl-16', issue: '16', file: 'spl-binder-16.pdf', pages: 66 },
  { id: 'spl-17', issue: '17', file: 'spl-binder-17.pdf', pages: 66 },
  { id: 'spl-18', issue: '18', file: 'spl-binder-18.pdf', pages: 66 },
]

const enBinderBooks: BinderBook[] = [
  { id: 'spl-02-en', issue: '02', file: 'spl-binder-02-en.pdf', pages: 64 },
  { id: 'spl-03-en', issue: '03', file: 'spl-binder-03-en.pdf', pages: 64 },
  { id: 'spl-04-en', issue: '04', file: 'spl-binder-04-en.pdf', pages: 64 },
  { id: 'spl-05-en', issue: '05', file: 'spl-binder-05-en.pdf', pages: 66 },
  { id: 'spl-06-en', issue: '06', file: 'spl-binder-06-en.pdf', pages: 64 },
  { id: 'spl-07-en', issue: '07', file: 'spl-binder-07-en.pdf', pages: 64 },
  { id: 'spl-08-en', issue: '08', file: 'spl-binder-08-en.pdf', pages: 66 },
  { id: 'spl-09-en', issue: '09', file: 'spl-binder-09-en.pdf', pages: 66 },
  { id: 'spl-10-en', issue: '10', file: 'spl-binder-10-en.pdf', pages: 66 },
  { id: 'spl-11-en', issue: '11', file: 'spl-binder-11-en.pdf', pages: 66 },
  { id: 'spl-12-en', issue: '12', file: 'spl-binder-12-en.pdf', pages: 66 },
  { id: 'spl-13-en', issue: '13', file: 'spl-binder-13-en.pdf', pages: 66 },
  { id: 'spl-14-en', issue: '14', file: 'spl-binder-14-en.pdf', pages: 66 },
  { id: 'spl-15-en', issue: '15', file: 'spl-binder-15-en.pdf', pages: 66 },
  { id: 'spl-16-en', issue: '16', file: 'spl-binder-16-en.pdf', pages: 66 },
  { id: 'spl-17-en', issue: '17', file: 'spl-binder-17-en.pdf', pages: 66 },
  { id: 'spl-18-en', issue: '18', file: 'spl-binder-18-en.pdf', pages: 66 },
]

export const binderBooks: BinderBook[] = getLang() === 'en' ? enBinderBooks : koBinderBooks

export function binderUrl(book: BinderBook): string {
  return `${import.meta.env.BASE_URL}binder/${book.file}`
}
