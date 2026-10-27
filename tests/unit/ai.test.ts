import { describe,it,expect } from 'vitest'
import { analyzeText,aiEndpoint } from '../../src/domain/ai'
import type { AIConfig } from '../../src/shared/integrations'
const base:AIConfig={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',enabled:true,allowCourseText:true,dailyLimit:20,anthropicVersion:'2023-06-01'}
const input='课程报告请在2026年10月30日交；提交后还要完成互评。'
const output=JSON.stringify({summary:'请按老师要求交报告并留意互评。',candidates:[{date:'2026-10-30',quote:'课程报告请在2026年10月30日交',label:'交报告'}],warnings:[]})
describe('AI wire compatibility and evidence',()=>{
  it.each(['deepseek','openai','anthropic'] as const)('supports %s without exposing the key in its returned result',async provider=>{
    let request:RequestInit|undefined,endpoint=''
    const fetcher=async(url:any,init:any)=>{endpoint=String(url);request=init;return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text:output}]}:{choices:[{message:{content:output}}]}),{status:200})}
    const result=await analyzeText({...base,provider,baseUrl:'https://service.example/v1',model:'configured-model'},'local-test-key',input,fetcher as typeof fetch)
    const body=JSON.parse(String(request!.body))
    expect(endpoint.endsWith(provider==='anthropic'?'/v1/messages':'/v1/chat/completions')).toBe(true)
    if(provider==='anthropic'){expect((request!.headers as any)['x-api-key']).toBe('local-test-key');expect(body.system).toContain('不编造时间');expect(body.max_tokens).toBe(1800)}
    else{expect((request!.headers as any).authorization).toBe('Bearer local-test-key');expect(body[provider==='deepseek'?'max_tokens':'max_completion_tokens']).toBe(1800)}
    expect(result.candidates[0].date).toBe('2026-10-30');expect(JSON.stringify(result)).not.toContain('local-test-key')
  })
  it('rejects ungrounded quotes and invalid dates',async()=>{
    const value=JSON.stringify({summary:'结果',candidates:[{date:'2026-10-31',quote:'原文没有这句话'},{date:'2026-02-30',quote:'课程报告请在2026年10月30日交'}]})
    const result=await analyzeText(base,'test',input,(async()=>new Response(JSON.stringify({choices:[{message:{content:value}}]}))) as typeof fetch)
    expect(result.candidates).toHaveLength(0);expect(result.warnings.length).toBeGreaterThan(0)
  })
  it('does not call an external service without explicit course-text consent',async()=>{let called=false;await expect(analyzeText({...base,allowCourseText:false},'key',input,(async()=>{called=true;return new Response()}) as typeof fetch)).rejects.toThrow('允许');expect(called).toBe(false)})
  it('rejects credentials in endpoints and remote plaintext HTTP',()=>{expect(()=>aiEndpoint({...base,baseUrl:'https://key:secret@service.example/'})).toThrow();expect(()=>aiEndpoint({...base,baseUrl:'http://service.example/'})).toThrow();expect(aiEndpoint({...base,baseUrl:'http://127.0.0.1:1234/v1'})).toBe('http://127.0.0.1:1234/v1/chat/completions')})
  it('does not leak upstream response bodies or credentials on errors',async()=>{await expect(analyzeText(base,'secret',input,(async()=>new Response('secret token response',{status:401})) as typeof fetch)).rejects.toThrow('HTTP 401')})
})
