import {fork,ChildProcess} from "child_process";
import {join,resolve} from "path";
import {Bot} from "@/bot";
export let child:ChildProcess
interface Message {
    type: 'start' | 'queue'
    body: any
}
let buffer = null
export function start(uin:number,options:Partial<Bot.Options>|string='simple.yaml'){
    child=fork(join(__dirname,'worker'),[],{
        env:{
            uin:String(uin),
            options:resolve(process.cwd(),typeof options==='string'?options:'simple.yaml')
        },
        execArgv:[
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
    let config: { autoRestart: boolean }
    child.on('message', (message: Message) => {
        if (message.type === 'start') {
            config = message.body
            if (buffer) {
                child.send({type: 'send', body: buffer})
                buffer = null
            }
        } else if (message.type === 'queue') {
            buffer = message.body
        }
    })
    const closingCode = [0, 130, 137]
    child.on('exit', (code) => {
        if (!config || closingCode.includes(code) || code !== 51 && !config.autoRestart) {
            process.exit(code)
        }
        start(uin,options)
    })
    return child
}
process.on('SIGINT', () => {
    if (child) {
        child.emit('SIGINT')
    } else {
        process.exit()
    }
})
