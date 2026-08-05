export interface ClockPort {
  nowIso(): string
}

export interface IdGeneratorPort {
  generate(scope: string): string
}
