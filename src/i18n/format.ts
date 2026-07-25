import { getLang } from './lang'
import { t } from './strings'

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatEntryDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = t('weekdaysShort')[new Date(year, month - 1, day).getDay()]
  if (getLang() === 'en') return `${EN_MONTHS[month - 1]} ${day} (${weekday})`
  return `${month}월 ${day}일 (${weekday})`
}

export function formatEntryDateDot(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  const weekday = t('weekdaysShort')[
    new Date(Number(year), Number(month) - 1, Number(day)).getDay()
  ]
  return `${year}.${month}.${day} (${weekday})`
}
