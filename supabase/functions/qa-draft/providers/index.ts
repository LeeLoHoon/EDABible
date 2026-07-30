import { AnthropicProvider } from './anthropic.ts'
import { OpenAiProvider } from './openai.ts'

export interface QaEvidence {
  chunkId: string
  sourceTitle: string
  body: string
}

export interface QaGenerationRequest {
  question: string
  lang: 'ko' | 'en'
  evidence: readonly QaEvidence[]
}

export interface QaAiProvider {
  readonly supportsEmbedding: boolean
  embed(input: string, signal: AbortSignal): Promise<number[]>
  generateDraft(input: QaGenerationRequest, signal: AbortSignal): Promise<string>
}

export interface QaProviderConfig {
  provider: 'openai' | 'anthropic'
  apiKey: string
  model: string
  embeddingModel: string
}

export function createQaProvider(config: QaProviderConfig): QaAiProvider {
  if (config.provider === 'openai') return new OpenAiProvider(config)
  return new AnthropicProvider(config)
}
