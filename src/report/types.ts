import { z } from 'zod';

/**
 * Subset of Playwright's JSON reporter format that this server relies on.
 * Unknown fields are allowed through, so newer Playwright versions keep working.
 */
const ErrorSchema = z.looseObject({
  message: z.string().optional(),
  stack: z.string().optional(),
});

const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.looseObject({
    title: z.string(),
    duration: z.number().optional(),
    error: ErrorSchema.optional(),
    steps: z.array(StepSchema).optional(),
  }),
);

export interface Step {
  title: string;
  duration?: number;
  error?: z.infer<typeof ErrorSchema>;
  steps?: Step[];
}

const AttachmentSchema = z.looseObject({
  name: z.string(),
  contentType: z.string(),
  path: z.string().optional(),
});

const ResultSchema = z.looseObject({
  status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
  retry: z.number().default(0),
  duration: z.number().default(0),
  error: ErrorSchema.optional(),
  errors: z.array(ErrorSchema).default([]),
  steps: z.array(StepSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
});

const TestSchema = z.looseObject({
  projectName: z.string().default(''),
  status: z.enum(['expected', 'unexpected', 'flaky', 'skipped']),
  annotations: z.array(z.looseObject({ type: z.string(), description: z.string().optional() })).default([]),
  results: z.array(ResultSchema).default([]),
});

const SpecSchema = z.looseObject({
  title: z.string(),
  file: z.string().default(''),
  line: z.number().optional(),
  tags: z.array(z.string()).default([]),
  tests: z.array(TestSchema).default([]),
});

export interface Suite {
  title: string;
  file?: string;
  specs?: z.infer<typeof SpecSchema>[];
  suites?: Suite[];
}

const SuiteSchema: z.ZodType<Suite> = z.lazy(() =>
  z.looseObject({
    title: z.string(),
    file: z.string().optional(),
    specs: z.array(SpecSchema).optional(),
    suites: z.array(SuiteSchema).optional(),
  }),
);

export const ReportSchema = z.looseObject({
  suites: z.array(SuiteSchema),
  stats: z
    .looseObject({
      expected: z.number(),
      unexpected: z.number(),
      flaky: z.number(),
      skipped: z.number(),
      duration: z.number(),
      startTime: z.string().optional(),
    })
    .optional(),
});

export type Report = z.infer<typeof ReportSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type TestEntry = z.infer<typeof TestSchema>;
export type Result = z.infer<typeof ResultSchema>;
