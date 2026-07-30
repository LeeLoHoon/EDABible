import { readFile } from 'node:fs/promises'
import { binderCheckpointTitles, checkpointTitle } from './binder_checkpoint_titles.mjs'
import { binderVideos } from './binder_videos.mjs'

const TITLE_SETS = new Set([
  'spl-timothy',
  'spl-bookstudy',
  'spl-timothy-en',
  'spl-bookstudy-en',
])

function issueFromCheckpointId(checkpointId) {
  return checkpointId.startsWith('issue-') ? checkpointId.slice('issue-'.length) : undefined
}

/** 실제 등록된 영상 제목을 후보로만 보고한다. 후보를 metadata로 자동 승격하지 않는다. */
export function titleCandidatesForCheckpoint(setId, checkpointId, videos = binderVideos) {
  if (!Object.prototype.hasOwnProperty.call(videos, setId)) return []
  const stages = videos[setId]
  if (!Array.isArray(stages)) return []

  const issue = issueFromCheckpointId(checkpointId)
  const stageId = issue === '00-01' ? '01' : issue
  const stage = stages.find((item) => item.stage === stageId)
  if (!stage || !Array.isArray(stage.lessons)) return []
  return stage.lessons.flatMap((lesson) =>
    typeof lesson.title === 'string' && lesson.title.trim() ? [lesson.title.trim()] : [],
  )
}

export function buildCheckpointTitleReport(sets, videos = binderVideos) {
  return sets
    .filter((set) => TITLE_SETS.has(set.id))
    .flatMap((set) =>
      set.checkpoints.flatMap((checkpoint) => {
        const lang = set.id.endsWith('-en') ? 'en' : 'ko'
        if (checkpointTitle(set.id, checkpoint.id, lang)) return []
        return [
          {
            setId: set.id,
            checkpointId: checkpoint.id,
            issue: checkpoint.issue,
            page: checkpoint.page,
            candidates: titleCandidatesForCheckpoint(set.id, checkpoint.id, videos),
          },
        ]
      }),
    )
}

export function validateCheckpointTitleMetadata(sets) {
  const checkpointIdsBySet = new Map(
    sets.map((set) => [set.id, new Set(set.checkpoints.map((checkpoint) => checkpoint.id))]),
  )
  const issues = []

  for (const [setId, titles] of Object.entries(binderCheckpointTitles)) {
    const checkpointIds = checkpointIdsBySet.get(setId)
    if (!checkpointIds) {
      issues.push(`unknown set: ${setId}`)
      continue
    }
    for (const [checkpointId, localized] of Object.entries(titles)) {
      if (!checkpointIds.has(checkpointId)) issues.push(`unknown checkpoint: ${setId}/${checkpointId}`)
      if (!localized || typeof localized !== 'object') {
        issues.push(`invalid translations: ${setId}/${checkpointId}`)
        continue
      }
      for (const [lang, title] of Object.entries(localized)) {
        if ((lang !== 'ko' && lang !== 'en') || typeof title !== 'string' || !title.trim()) {
          issues.push(`invalid title: ${setId}/${checkpointId}/${lang}`)
        }
      }
    }
  }
  return issues
}

async function main() {
  const sets = JSON.parse(await readFile(new URL('./binder-sets.json', import.meta.url), 'utf8'))
  const issues = validateCheckpointTitleMetadata(sets)
  if (issues.length > 0) {
    console.error(JSON.stringify({ metadataIssues: issues }, null, 2))
    process.exitCode = 1
    return
  }

  const missing = buildCheckpointTitleReport(sets)
  console.log(JSON.stringify({ missingTitleCount: missing.length, missing }, null, 2))
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await main()
}
