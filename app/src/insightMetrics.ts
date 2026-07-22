export type CompletionSummary = {
  completed: number;
  in_progress: number;
  brief: number;
  total: number;
  average_percent: number;
};

export function summarizeCompletion(progressValues: number[]): CompletionSummary {
  const values = progressValues.map((value) => Math.max(0, Math.min(1, value)));
  return {
    completed: values.filter((value) => value >= .9).length,
    in_progress: values.filter((value) => value >= .1 && value < .9).length,
    brief: values.filter((value) => value < .1).length,
    total: values.length,
    average_percent: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) : 0,
  };
}
