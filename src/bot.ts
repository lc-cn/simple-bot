import {Client, Config, GroupMessageEvent, PrivateMessageEvent} from 'oicq'
import Koa from 'koa'
import * as yaml from 'js-yaml'
import {resolve} from 'path'
import {writeFileSync,readFileSync} from "fs";
import {Context} from "@/context";
import {deepMerge} from "@/utils";
import {fileExistsSync} from "tsconfig-paths/lib/filesystem";
import {Command} from "@/command";
import EventDeliver from "event-deliver";
import {Argv} from "@/argv";
export class Bot extends Client{
    public plugins:Map<string,Context>=new Map<string, Context>()
    public pluginPaths:Map<string,string>=new Map<string, string>()
    public services:Partial<Bot.Services>={}
    private commandList:Command[]=[]
    public commands:Map<string,Command>=new Map<string,Command>()
    public options:Bot.Options
    constructor(uin:number,options:Partial<Bot.Options>={}) {
        deepMerge(options,Bot.defaultOptions)
        super(uin,options);
        this.options=options as Bot.Options
    }
    loadPlugins(){
        return Object.keys(this.options.plugins)
            .map((name)=>[name,this.loadPlugin(name)])
            .filter(([_,path])=>Boolean(path))
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
            return  this.resolvePath(name,[
                `${this.options.plugin_dir}/${name}`,
                `${__dirname}/plugins/${name}`,
                `@simple-bot/plugin-${name}`,
                `simple-bot-plugin-${name}`
            ])
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
    async emitSync(event:string|symbol,...args:any[]){
        for(const listener of this.listeners(event)){
            await listener(...args)
        }
    }
    async dispatch(event:string,...args:any[]){
        for(const [_,ctx] of this.plugins){
            await ctx.emitSync(event,...args)
        }
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
    async start (){
        for(const [name,path] of this.loadPlugins()){
            try{
                require(path)
                await this.dispatch(`plugin${name}.loaded`)
            }catch (e) {
                console.error(`加载插件${name}失败：${e.message}`)
            }
        }
        await this.dispatch('bot.start')
        await this.dispatch('bot.ready')
        this.login(this.options.password)
    }
}
export interface Bot extends Bot.Services{}
declare global{
    export var __SIMPLE_BOT__:Bot
}
export function createBot(uin:number,config:Partial<Bot.Options>|string='simple.yaml'){
    if(typeof config!=="string") writeFileSync(resolve(process.cwd(),config.saveTo||'simple.yaml'),yaml.dump(config),"utf8")
    else {
        if(!fileExistsSync(resolve(process.cwd(),config))){
            writeFileSync(resolve(process.cwd(),config),yaml.dump(Bot.defaultOptions),'utf8')
        }
        config=yaml.load(readFileSync(config,"utf8")) as Bot.Options
    }
    return global.__SIMPLE_BOT__=new Bot(uin,config)
}
export namespace Bot{
    export interface Options extends Config{
        saveTo?:string
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
