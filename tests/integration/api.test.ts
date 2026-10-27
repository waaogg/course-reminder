import { it,expect } from 'vitest'
import { LocalAPI } from '../../src/main/local-api'
import type { Snapshot } from '../../src/shared/types'
it('authenticates and paginates local API calls; rejects web origins and wrong tokens',async()=>{
  let syncs=0
  const snapshot={version:'1.0.0',busy:[],tasks:[{id:'t1'},{id:'t2'}],courses:[{id:'c'}],notices:[],accounts:[],coverage:[],nextSync:'2026-10-27T00:00:00Z'} as unknown as Snapshot
  const api=new LocalAPI('test-token-very-long-for-local-test',{snapshot:()=>snapshot,sync:()=>syncs++})
  await api.start(0)
  const url=`http://127.0.0.1:${api.port}`,headers={authorization:'Bearer test-token-very-long-for-local-test'}
  try{
    expect((await fetch(url+'/v1/tasks')).status).toBe(401)
    expect((await fetch(url+'/v1/tasks',{headers:{authorization:'Bearer wrong'}})).status).toBe(401)
    expect((await fetch(url+'/v1/tasks',{headers:{...headers,origin:'https://evil.example'}})).status).toBe(403)
    const list=await(await fetch(url+'/v1/tasks?limit=1&offset=1',{headers})).json()
    expect(list.items).toEqual([{id:'t2'}]);expect(list.total).toBe(2)
    expect((await fetch(url+'/v1/sync',{method:'POST',headers})).status).toBe(202);expect(syncs).toBe(1)
    const spec=await(await fetch(url+'/v1/openapi.json',{headers})).json();expect(spec.openapi).toBe('3.0.3');expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
    expect((await fetch(url+'/v1/unknown',{headers})).status).toBe(404)
  }finally{await api.stop()}
})
