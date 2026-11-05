import { Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { ClaimsAgent, DUPLICATE_DETECTOR } from './claims-agent';
import { CaseRegistryTool } from './tools/case-registry.tool';
import { CaseSummaryTool } from './tools/case-summary.tool';
import { ClaimClassifierTool } from './tools/claim-classifier.tool';
import { DocumentAnalyzerTool } from './tools/document-analyzer.tool';
import { DuplicateDetectorTool } from './tools/duplicate-detector.tool';

@Module({
  providers: [
    DocumentAnalyzerTool,
    ClaimClassifierTool,
    CaseRegistryTool,
    CaseSummaryTool,
    {
      provide: DUPLICATE_DETECTOR,
      inject: [ENV],
      useFactory: (env: Env) => new DuplicateDetectorTool(env.DUPLICATE_SIMILARITY_THRESHOLD),
    },
    ClaimsAgent,
  ],
  exports: [ClaimsAgent, CaseRegistryTool, CaseSummaryTool],
})
export class AgentModule {}
