import {Bot} from "@/bot";
import EventDeliver from "event-deliver";
import {dirname} from "path";
import {Command} from "@/command";
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
    if(fileFullPath.endsWith('index.js')||fileFullPath.endsWith('index.js')){
        const dirnameArr=dirname(fileFullPath).split('/')
        return dirnameArr[dirnameArr.length-1]
    }
    const fileDirArr=fileFullPath.split('/')
    return fileDirArr[fileDirArr.length-1].replace(/\.js|\.ts$/,'')
}
const lockKey=Symbol('canConstruct')
export class Context<T extends object={}>{
    public bot:Bot
    static [lockKey]:boolean=false
    public mainFile:string
    public dependencies:string[]=[]
    public disposes:Function[]=[]
    constructor(public runtimeConfig?:Context.Config<T>) {
        if(!Context[lockKey]) throw new Error('请使用useContext创建')
        this.bot=global.__SIMPLE_BOT__
        const mainFile=getStack().map(stack=>stack.getFileName()).filter((filePath)=>!filePath.startsWith(__dirname))[0]
        if(!mainFile) throw new Error('只能在插件中调用')
        const name=runtimeConfig?.name||getName(mainFile)
        this.mainFile=mainFile
        this.dependencies=require.cache[mainFile].children
            .map(child=>child.filename)
        if(this.bot.plugins.get(name)) throw new Error('重复定义插件：'+name)
        const context=new Proxy(this,{
            get(target: Context<T>, p: string | symbol, receiver: any): any {
                if(Object.prototype.hasOwnProperty.call(target,p)){
                    return Reflect.get(target,p,receiver)
                }
                const fn=Reflect.get(target.bot,p,receiver)
                if(typeof p==='string' && proxyKeys.includes(p)) return new Proxy(fn,{
                    apply(target: Function, thisArg: any, argArray: any[]): any {
                        const result= target.apply(thisArg,argArray)
                        if(result instanceof Command){
                            result.ctx=context
                            context.disposes.push(()=>{
                                context.bot.commands.delete(result.name)
                            })
                        }else{
                            context.disposes.push(result)
                        }
                        return result
                    }
                })
                return fn
            }
        })
        this.bot.plugins.set(name,context)

        const proxyKeys:string[]=['addEventListener','middleware','command']
        return context
    }
    dispose(){
        while (this.disposes.length){
            const dispose=this.disposes.shift()
            dispose()
        }
    }
}
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
export interface Context<T> extends Bot{
}
export namespace Context{
    export class Config<T extends object> extends EventDeliver{
        private readonly value:T
        constructor(public name:string) {
            super()
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