import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,matches,pickAutomation} from './match.mjs';
const base={id:'1',scope:'all',active:true,keywords:['OJO'],match_mode:'contains',fuzzy:true,starts_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z'};
test('normalización y palabras completas con comentarios reales',()=>{
 assert.equal(normalize('Ojo!!! 👁️'),'ojo');
 for(const text of ['OJO','Oko','¡Quiero OJO!','ÓJO'])assert.equal(matches(text,base),true,text);
 for(const text of ['ojito','👁️','mcpserver'])assert.equal(matches(text,{...base,keywords:[text==='mcpserver'?'MCP':'OJO']}),false,text);
 assert.equal(matches('quiero el mcp',{...base,keywords:['MCP']}),true);
 assert.equal(matches('MCP!!',{...base,keywords:['MCP']}),true);
 assert.equal(matches('quiero ojo',{...base,match_mode:'exact'}),false);
 assert.equal(matches('oko',{...base,fuzzy:false}),false);
 assert.equal(matches('a',{...base,keywords:['IA']}),false);
 assert.equal(matches('guía gratis',{...base,keywords:['guia gratis']}),true);
});
test('prioridad, cuenta propia y fecha de inicio',()=>{
 const c={id:'comment',mediaId:'10',userId:'visitor',text:'ojo',at:'2026-10-05T00:00:00Z'};
 assert.equal(pickAutomation(c,[base,{...base,id:'2',scope:'media',media_id:'10'}],'owner').id,'2');
 assert.equal(pickAutomation({...c,userId:'owner'},[base],'owner'),null);
 assert.equal(pickAutomation({...c,at:'2026-09-01T00:00:00Z'},[base],'owner'),null);
 assert.equal(pickAutomation(c,[{...base,active:false}],'owner'),null);
 assert.equal(pickAutomation(c,[{...base,scope:'next_publish'}],'owner'),null);
});
