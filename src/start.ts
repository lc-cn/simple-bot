import {fork,ChildProcess} from "child_process";
import {join,resolve} from "path";
import {Bot} from "@/bot";
export let child:ChildProcess
interface Message {
    type: 'start' | 'queue'
    body: any
}
let buffer = null
export function start(uin:number,options:Partial<Bot.Options>|string='bot'){
    child=fork(join(__dirname,'worker'),[],{
        env:{
            uin:String(uin),
            options:resolve(process.cwd(),typeof options==='string'?options:'bot')
        },
        execArgv:[
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
    child.on('message', (message: Message) => {
        if (message.type === 'start') {
            if (buffer) {
                child.send({type: 'send', body: buffer})
                buffer = null
            }
        } else if (message.type === 'queue') {
            buffer = message.body
        }
    })
    child.on('exit', (code) => {
        if (code !== 51) {
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
