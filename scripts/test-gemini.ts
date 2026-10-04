import {gemini,getGeminiClient,geminiError} from '../src/ai/gemini.js';
import {env} from '../src/config/env.js';
import {db} from '../src/database/client.js';
if(!env.GEMINI_API_KEY){console.log('Gemini connection test blocked: GEMINI_API_KEY is not configured privately in .env.');process.exitCode=1;}
else try {
  const model=await getGeminiClient().models.get({model:env.GEMINI_MODEL});
  console.log(JSON.stringify({configuredModel:env.GEMINI_MODEL,available:Boolean(model.name)}));
  const result=await gemini.generate('Reply with exactly: Craftland India AI is ready.',{type:'connection_test',actorId:'local-operator',guildId:''});
  console.log(JSON.stringify({success:result.success,model:result.model,status:result.success?'Operational':result.error,usage:result.usage}));if(!result.success)process.exitCode=1;
}catch(error){console.error(geminiError(error));process.exitCode=1;}finally{await db.$disconnect();}
