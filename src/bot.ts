import {Client, Config, GroupMessageEvent, PrivateMessageEvent} from 'oicq'
import Koa from 'koa'
import {FSWatcher,watch} from "chokidar";
import * as yaml from 'js-yaml'
import {resolve} from 'path'
import {readFileSync,existsSync, writeFileSync} from "fs";
import {Context} from "@/context";
import {deepMerge} from "@/utils";
import {Command} from "@/command";
import {Argv} from "@/argv";
export class Bot extends Client{
    public plugins:Map<string,Context>=new Map<string, Context>()
    public services:Partial<Bot.Services>={}
    isStarted:boolean=false
    isReady:boolean=false
    master:number
    admins:number[]
    public options:Bot.Options
    constructor(uin:number,options:Partial<Bot.Options>={}) {
        deepMerge(options,Bot.defaultOptions)
        super(uin,options);
        this.master=options.master
        this.admins=[].concat(options.admins).filter(Boolean)
        this.options=options as Bot.Options
    }
    emit(event:string|symbol,...args:any[]){
        this.dispatch(event,...args)
        return super.emit(event,...args)
    }
    loadPlugins(){
        Object.keys(this.options.plugins)
            .forEach((name)=>{
                this.loadPlugin(name)
                console.log('已加载插件'+name)
            })
    }
    get pluginDependencies(){
        return Array.from(new Set([...this.plugins.values()].map(plugin=>{
            return [plugin.mainFile,...plugin.dependencies]
        }).flat()))
    }
    service<K extends keyof Bot.Services>(key:K):Bot.Services[K]|undefined
    service<K extends keyof Bot.Services>(key:K,service:Bot.Services[K]):this
    service(key:string,service?:any){
        if(!service) return this.services[key]
        this.services[key]=service
        return this
    }
    public loadPlugin(name:string){
        try{
            const resolvedPath=this.resolvePath(name,[
                `${this.options.plugin_dir}/${name}`,
                `${__dirname}/plugins/${name}`,
                `@simple-bot/plugin-${name}`,
                `simple-bot-plugin-${name}`
            ])
            require(resolvedPath)
            this.dispatch(`plugin.${name}.mounted`)
            if(this.isStarted){
                this.plugins.get(name)?.emit('bot.start')
            }
            if(this.isReady){
                this.plugins.get(name)?.emit('bot.ready')
            }
        }catch (e){
            console.error(e.message)
        }
    }
    private resolvePath(name:string,tryPathArr:string[]){
        for(const tryPath of tryPathArr){
            try{
                return require.resolve(resolve(process.cwd(),tryPath))
            }catch {}
        }
        throw new Error('未找到：'+name)
    }
    async dispatch(event:string|symbol,...args:any[]){
        for(const [_,ctx] of this.plugins){
            if(ctx.disabled) continue
            await ctx.emitSync(event,...args)
        }
    }
    async bailSync(event:string|symbol,...args:any[]){
        const listeners=this.listeners(event)
        for(const listener of listeners){
            let result=await listener(...args)
            if(result) return result
        }
    }
    watch(dir:string,onChange:(filePath:string)=>any){
        const watcher = watch(dir,{
            ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
        })
        watcher.on('change',onChange)
    }
    async start (){
        this.loadPlugins()
        this.watch(resolve(process.cwd(),this.options.plugin_dir),(filename)=>{
            const restartPlugin=(name:string,plugin:Context)=>{
                plugin.emit('dispose')
                if(plugin.mainFile!==filename){
                    delete require.cache[plugin.mainFile]
                }
                delete require.cache[filename]
                this.plugins.delete(name)
                this.loadPlugin(name.replace('plugins','').slice(1))
                console.log(`plugin （${name}） restarted`)
            }
            if(!this.pluginDependencies.includes(filename)) return
            for(const [name,plugin] of this.plugins){
                if(plugin.mainFile===filename){
                    console.log(`plugin (${name})${filename} changed，restarting...`)
                    restartPlugin(name,plugin)
                    break;
                }
            }
            const needRestartPlugins:[string,Context][]=[]
            for(const [name,plugin] of this.plugins){
                if(plugin.dependencies.includes(filename)){
                    console.log(`plugin (${name}) dependencies:${filename} changed，restarting...`)
                    needRestartPlugins.push([name,plugin])
                    break;
                }
            }
            needRestartPlugins.forEach(([name,plugin])=>{
                restartPlugin(name,plugin)
            })
        })
        await this.dispatch('bot.start')
        this.isStarted=true
        await this.dispatch('bot.ready')
        this.login(this.options.password)
        this.isReady=true
    }
}
export interface Bot extends Bot.Services{}
declare global{
    export var __SIMPLE_BOT__:Bot
}
export function createBot(uin:number,config:Partial<Bot.Options>|string='simple.yaml'){
    if(typeof config!=="string") writeFileSync(resolve(process.cwd(),config.saveTo||'simple.yaml'),yaml.dump(config),"utf8")
    else {
        if(!existsSync(resolve(process.cwd(),config))){
            writeFileSync(resolve(process.cwd(),config),yaml.dump(Bot.defaultOptions),'utf8')
        }
        config=yaml.load(readFileSync(config,"utf8")) as Bot.Options
    }
    return global.__SIMPLE_BOT__=new Bot(uin,config)
}
export namespace Bot{
    export interface Options extends Config{
        saveTo?:string
        master?:number
        admins?:number|number[]
        plugins:Record<string, Record<string, any>>
        password?:string
        plugin_dir:string
    }
    export interface MessageEvent{
        group:GroupMessageEvent
        private:PrivateMessageEvent
    }
    export const defaultOptions:Partial<Options>={
        saveTo:'simple.yaml',
        plugins:{},
        plugin_dir:'plugins',
        data_dir:resolve(process.cwd(),'data')
    }
    export interface Services{
        koa:Koa
    }
}
