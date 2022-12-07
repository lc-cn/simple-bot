import {createBot} from "@/bot";
import {resolve} from 'path'
const uin=Number(process.env.uin)
const options=process.env.configPath||resolve(process.cwd(),'bot')
createBot(uin,options).start()
