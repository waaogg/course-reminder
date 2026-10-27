export type AIProvider = 'deepseek' | 'openai' | 'anthropic'
export interface AIConfig { enabled:boolean; provider:AIProvider; baseUrl:string; model:string; allowCourseText:boolean; dailyLimit:number; anthropicVersion:string }
export interface APIConfig { enabled:boolean; port:number }
export interface IntegrationStatus { ai:AIConfig; api:APIConfig; hasAIKey:boolean; encryptedStorage:boolean; apiRunning:boolean; apiError:string; apiBaseUrl:string; requestsToday:number }
export interface AIResult { summary:string; candidates:{date:string;time?:string;quote:string;label:string}[]; warnings:string[]; provider:AIProvider; model:string; at:string }
export const providerDefaults:Record<AIProvider,{baseUrl:string;model:string}>={deepseek:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash'},openai:{baseUrl:'https://api.openai.com/v1',model:''},anthropic:{baseUrl:'https://api.anthropic.com/v1',model:''}}
