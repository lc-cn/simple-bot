import {Bot} from "@/bot";
import {dirname} from "path";
import {Command} from "@/command";
import {DiscussMessageEvent, EventMap, GroupMessageEvent, PrivateMessageEvent, Sendable} from "oicq";
import {Argv} from "@/argv";
import {EventEmitter} from "events";
import {remove} from "@/utils";
function getMainPath(paths:string[]){
    if(paths.length===1) return paths[0]
    return paths.find(p=>p.endsWith('index.js') || p.endsWith('index.ts'))
}
export function getStack(): NodeJS.CallSite[] {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;

    const stack: NodeJS.CallSite[] = new Error().stack as any;

    Error.prepareStackTrace = orig;
    return stack;
}
export function getName(fileFullPath:string){
    const getSubName=()=>{
        if(fileFullPath.endsWith('index.js')||fileFullPath.endsWith('index.ts')){
            return dirname(fileFullPath).replace(process.cwd(),'').replace(/\/index\.(t|j)s/,'')
        }
        return fileFullPath.replace(process.cwd(),'').replace(/\.(t|j)s/,'')
    }
    return getSubName().slice(1)
}
const lockKey=Symbol('canConstruct')
export class Context<T extends object={}> extends EventEmitter{
    public bot:Bot
    static [lockKey]:boolean=false
    public mainFile:string
    public disabled:boolean=false
    public dependencies:string[]=[]
    middlewares:Middleware[]=[]
    public commands:Map<string,Command>=new Map<string,Command>()
    private commandList:Command[]=[]
    public disposes:Function[]=[]
    constructor(public runtimeConfig?:Context.Config<T>) {
        if(!Context[lockKey]) throw new Error('请使用useContext创建')
        super()
        this.bot=global.__SIMPLE_BOT__
        const mainFile=getStack().map(stack=>stack.getFileName()).filter((filePath)=>!filePath.startsWith(__dirname))[0]
        if(!mainFile) throw new Error('只能在插件中调用')
        const name=runtimeConfig?.name||getName(mainFile)
        this.mainFile=mainFile
        this.dependencies=require.cache[mainFile].children
            .map(child=>child.filename).filter(filename=>{
                return ![...this.bot.plugins.values()].map(p=>p.mainFile).includes(filename)
            })
        if(this.bot.plugins.get(name)) throw new Error('重复定义插件：'+name)
        const context=new Proxy(this,{
            get(target: Context<T>, p: string | symbol, receiver: any): any {
                let source=Reflect.get(target,p,receiver)
                if(source !==undefined){
                    return Reflect.get(target,p,receiver)
                }
                return Reflect.get(target.bot,p,receiver)
            }
        })
        this.bot.plugins.set(name,context)
        this.middleware(async (message,next)=>{
            const result=await this.executeCommand(message).catch(e=>e.message as string)
            if(result && typeof result!=='boolean') await message.reply(result)
            else next()
        })
        this.on('message',(event)=>{
            const middleware=this.compose()
            middleware(event)
        })
        this.on('dispose',()=>{
            while (this.disposes.length){
                this.disposes.shift()()
            }
        })

        return context
    }
    command<D extends string,E extends keyof Bot.MessageEvent>(def:D,trigger?:E):Command<Argv.ArgumentType<D>>{
        const namePath = def.split(' ', 1)[0]
        const decl = def.slice(namePath.length)
        const segments = namePath.split(/(?=[/])/g)
        let parent: Command, nameArr=[]
        while (segments.length){
            const segment=segments.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if(segments.length)parent=this.commandList.find(cmd=>cmd.name===tempName)
            if(!parent && segments.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name=nameArr.pop()
        const command = new Command(name+decl,trigger)
        if(parent){
            command.parent=parent
            parent.children.push(command)
        }
        this.commands.set(name,command)
        this.commandList.push(command)
        return Object.create(command)
    }
    async emitSync(event:string|symbol,...args:any[]){
        for(const listener of this.listeners(event)){
            await listener(...args)
        }
    }
    use(middleware:Middleware):this{
        this.middleware(middleware)
        return this
    }
    middleware(middleware:Middleware,prepend?:boolean):Dispose{
        const method:'push'|'unshift'=prepend?"unshift":"push"
        if(this.middlewares.indexOf(middleware)!==-1) return ()=>remove(this.middlewares,middleware)
        this.middlewares[method](middleware)
        const dispose=()=>remove(this.middlewares,middleware)
        this.disposes.push(dispose)
        return dispose
    }
    static getChannelId(event:Dict){
        return [event.message_type,event.group_id||event.discuss_id||event.sender.user_id].join(':') as ChannelId
    }
    static getFullChannelId(event:MessageEvent):string{
        return [event.message_type,event['group_id'],event['discuss_id'],event['sub_type'],event.user_id]
            .filter(Boolean)
            .join(':')
    }
    private compose (middlewares:Middleware[]=this.middlewares):ComposedMiddleware {
        if (!Array.isArray(middlewares)) throw new TypeError('Middleware stack must be an array!')
        for (const fn of middlewares) {
            if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
        }
        return (message:MessageEvent, next?:Next)=> {
            let index = -1
            const dispatch= (i,event=message)=>{
                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i
                let fn = middlewares[i]
                if (i === middlewares.length) fn = next
                if (!fn) return Promise.resolve()
                try {
                    return Promise.resolve(fn(event, dispatch.bind(null, i + 1)));
                } catch (err) {
                    return Promise.reject(err)
                }
            }
            return dispatch(0)
        }
    }
    findCommand(argv: Argv) {
        return this.commandList.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.cqCode))
        })
    }
    async execute(argv:Partial<Argv>){
        if(!argv.bot)argv.bot=this.bot
        if(!argv.args)argv.args=[]
        if(!argv.argv)argv.argv=[]
        if(!argv.cqCode) argv.cqCode=argv.event.toCqcode()
        if(!argv.options) argv.options={}
        const command=this.findCommand(argv as Argv)
        if(command && command.match(argv.event)){
            let result:Sendable|void|boolean
            result= await this.bailSync('before-command',argv)
            if (result) return result
            try{
                return await command.execute(argv as Argv)
            }catch (e){
                this.logger.warn(e.message)
            }
        }
    }
    async executeCommand(message:MessageEvent,cqCode=message.toCqcode()):Promise<Sendable|boolean|void>{
        const argv=Argv.parse(cqCode)
        argv.event=message as any
        return this.execute(argv)
    }
    sendMsg(channelId: ChannelId, message: Sendable) {
        const [targetType,targetId] = channelId.split(':') as [TargetType,`${number}`]
        switch (targetType){
            case "discuss":
                return this.sendDiscussMsg(Number(targetId),message)
            case "group":
                return this.sendGroupMsg(Number(targetId),message)
            case "private":
                return this.sendPrivateMsg(Number(targetId),message)
            default:
                throw new Error('无法识别的channelId:'+channelId)
        }
    }
    setTimeout(callback:Function,ms:number,...args):Dispose{
        const timer=setTimeout(()=>{
            callback()
            dispose()
            remove(this.disposes,dispose)
        },ms,...args)
        const dispose=()=>{clearTimeout(timer);return true}
        this.disposes.push(dispose)
        return dispose
    }
    setInterval(callback:Function,ms:number,...args):Dispose{
        const timer=setInterval(callback,ms,...args)
        const dispose=()=>{clearInterval(timer);return true}
        this.disposes.push(dispose)
        return dispose
    }
    enable(){
        this.disabled=false
    }
    disable(){
        this.disabled=true
    }
}
export type Dispose=()=>any
export type Awaitable<R extends any=void>=R|Promise<R>
export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${TargetType}:${number}`
export type Middleware = (event: MessageEvent, next: Next) => Awaitable<Sendable|boolean|void>;
export type ComposedMiddleware = (event: MessageEvent, next?: Next) => Awaitable<Sendable|boolean|void>
export type Dict<T extends any=any,K extends (symbol|string)=string>={
    [P in K]:T
}
export type Next = () => Promise<any>;
export type MessageEvent=PrivateMessageEvent|GroupMessageEvent|DiscussMessageEvent
export function useConfig(key:string){
    return new Context.Config(key)
}
export function useContext<T extends object={}>(config?:Context.Config<T>){
    // 解锁
    Context[lockKey]=true
    const context=new Context(config)
    Context[lockKey]=false
    return context
}
export interface ContextEventMap<T extends object={}> extends EventMap<Context<T>>{
    dispose():void
}
export interface Context<T> extends Omit<Bot, keyof EventEmitter>{
    on<K extends keyof ContextEventMap<T>>(event:K,listener:ContextEventMap<T>[K]):this
    on<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,listener:(...args:any)=>any):this
    once<K extends keyof ContextEventMap<T>>(event:K,listener:ContextEventMap<T>[K]):this
    once<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,listener:(...args:any)=>any):this
    addListener<K extends keyof ContextEventMap<T>>(event:K,listener:ContextEventMap<T>[K]):this
    addListener<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,listener:(...args:any)=>any):this
    off<K extends keyof ContextEventMap<T>>(event:K,listener:ContextEventMap<T>[K]):this
    off<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,listener:(...args:any)=>any):this
    removeListener<K extends keyof ContextEventMap<T>>(event:K,listener:ContextEventMap<T>[K]):this
    removeListener<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,listener:(...args:any)=>any):this
    emit<K extends keyof ContextEventMap<T>>(event:K,...args:Parameters<ContextEventMap<T>[K]>):boolean
    emit<S extends string|symbol>(event:S & Exclude<S, keyof ContextEventMap<T>>,...args:any[]):boolean
}
export namespace Context{
    export class Config<T extends object>{
        private readonly value:T
        constructor(public name:string) {
            if(!global.__SIMPLE_BOT__) throw new Error('must createBot before useConfig')
            this.value = (global.__SIMPLE_BOT__.options.plugins[name] || {}) as T
        }
        get<K extends keyof T>(key:K):T[K]{
            return this.value[key]
        }
        set<K extends keyof T>(key:K,value:T[K]){
            this.value[key]=value
        }
        toJSON(){
            return JSON.stringify(this.value)
        }
    }
}
