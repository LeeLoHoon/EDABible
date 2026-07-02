export interface BinderBook {
  id: string
  title: string
  issue: string
  file: string
  pages: number
}

export const binderBooks: BinderBook[] = [
  { id: 'spl-00-01', title: 'SPL 바인더 00-01', issue: '00-01', file: 'spl-binder-00-01.pdf', pages: 172 },
  { id: 'spl-02', title: 'SPL 바인더 02', issue: '02', file: 'spl-binder-02.pdf', pages: 64 },
  { id: 'spl-03', title: 'SPL 바인더 03', issue: '03', file: 'spl-binder-03.pdf', pages: 64 },
  { id: 'spl-04', title: 'SPL 바인더 04', issue: '04', file: 'spl-binder-04.pdf', pages: 64 },
  { id: 'spl-05', title: 'SPL 바인더 05', issue: '05', file: 'spl-binder-05.pdf', pages: 66 },
  { id: 'spl-06', title: 'SPL 바인더 06', issue: '06', file: 'spl-binder-06.pdf', pages: 64 },
  { id: 'spl-07', title: 'SPL 바인더 07', issue: '07', file: 'spl-binder-07.pdf', pages: 64 },
  { id: 'spl-08', title: 'SPL 바인더 08', issue: '08', file: 'spl-binder-08.pdf', pages: 66 },
  { id: 'spl-09', title: 'SPL 바인더 09', issue: '09', file: 'spl-binder-09.pdf', pages: 66 },
  { id: 'spl-10', title: 'SPL 바인더 10', issue: '10', file: 'spl-binder-10.pdf', pages: 66 },
  { id: 'spl-11', title: 'SPL 바인더 11', issue: '11', file: 'spl-binder-11.pdf', pages: 66 },
  { id: 'spl-12', title: 'SPL 바인더 12', issue: '12', file: 'spl-binder-12.pdf', pages: 66 },
  { id: 'spl-13', title: 'SPL 바인더 13', issue: '13', file: 'spl-binder-13.pdf', pages: 66 },
  { id: 'spl-14', title: 'SPL 바인더 14', issue: '14', file: 'spl-binder-14.pdf', pages: 66 },
  { id: 'spl-15', title: 'SPL 바인더 15', issue: '15', file: 'spl-binder-15.pdf', pages: 66 },
  { id: 'spl-16', title: 'SPL 바인더 16', issue: '16', file: 'spl-binder-16.pdf', pages: 66 },
  { id: 'spl-17', title: 'SPL 바인더 17', issue: '17', file: 'spl-binder-17.pdf', pages: 66 },
  { id: 'spl-18', title: 'SPL 바인더 18', issue: '18', file: 'spl-binder-18.pdf', pages: 66 },
]

export function binderUrl(book: BinderBook): string {
  return `${import.meta.env.BASE_URL}binder/${book.file}`
}
