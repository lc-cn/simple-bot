import Koa from 'koa'
import {Client, GroupMessageEvent, PrivateMessageEvent} from "onebot-client";
import {watch} from "chokidar";
import * as yaml from 'js-yaml'
import {getLogger, Logger} from "log4js";
import {dirname, resolve} from 'path'
import {readFileSync,readdirSync,existsSync, writeFileSync} from "fs";
import {Context} from "@/context";
import {deepMerge, isSame} from "@/utils";
import {Command} from "@/command";
import {useHelp} from "@/help";
export class Bot extends Client{
    public plugins:Map<string,Context>=new Map<string, Context>()
    public services:Partial<Bot.Services>={}
    public logger:Logger
    isStarted:boolean=false
    isReady:boolean=false
    master:number
    admins:number[]
    public options:Bot.Options
    constructor(uin:number,options:Partial<Bot.Options>={}) {
        deepMerge(options,Bot.defaultOptions)
        super(uin,options.remote_url||options as Bot.Options);
        this.logger=getLogger('simple-bot')
        this.logger.level=options.log_level
        this.master=options.master
        this.admins=[].concat(options.admins).filter(Boolean)
        this.options=options as Bot.Options
    }
    get commandList():Command[]{
        return [...this.plugins.values()].filter(p=>!p.disabled).map(p=>p.commandList).flat()
    }
    emit(event:string|symbol,...args:any[]){
        console.log(event,...args)
        this.dispatch(event,...args)
        return super.emit(event,...args)
    }
    loadLocalPlugins(userPluginDir:string){
        if(existsSync(userPluginDir)){
            const files=readdirSync(userPluginDir,{withFileTypes:true})
            files.forEach((file) => {
                if(file.isFile()){
                    if(file.name.endsWith('.js') || (file.name.endsWith('.ts') && !file.name.endsWith('.d.ts'))){
                        const filename = file.name.replace('.js', '').replace('.ts','');
                        require(userPluginDir+'/'+filename);
                    }
                }else{
                    this.loadLocalPlugins(userPluginDir+'/'+file.name)
                }
            });
        }
    }
    loadModulePlugins(){
        const packageJsonPath=resolve(process.cwd(),'package.json')
        if(existsSync(packageJsonPath)){
            const {dependencies={}}=require(packageJsonPath)
            Object.keys(dependencies).filter(name=>{
                return /^(@spoint\/bot-|spoint-bot-\/)plugin-.*/.test(name)
            }).forEach(name=>{
                require(name)
            })
        }
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
                `@spoint/bot-plugin-${name}`,
                `spoint-bot-plugin-${name}`
            ])
            require(resolvedPath)
            this.dispatch(`plugin.${name}.mounted`)
            if(this.isStarted){
                this.plugins.get(name)?.trip('bot.start')
            }
            if(this.isReady){
                this.plugins.get(name)?.trip('bot.ready')
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
            await ctx.tripAsync(event,...args)
        }
    }
    watch(dir:string,onChange:(filePath:string)=>any){
        const watcher = watch(dir,{
            ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
        })
        watcher.on('change',onChange)
    }
    restartPlugin(name:string,plugin:Context,changeFile:string){
        plugin.trip('dispose')
        if(plugin.mainFile!==changeFile){
            delete require.cache[plugin.mainFile]
        }
        delete require.cache[changeFile]
        this.plugins.delete(name)
        this.loadPlugin(name.replace('plugins','').slice(1))
        console.log(`plugin （${name}） restarted`)
    }
    private watchConfigChange(){
        const configFilePath=resolve(process.cwd(),this.options.saveTo)
        const configDir=dirname(configFilePath)
        this.watch(configDir,(filename)=>{
            if(filename!==configFilePath) return
            const newConfig=deepMerge(Bot.defaultOptions,yaml.load(readFileSync(filename,"utf8"))) as Bot.Options
            const oldConfig=JSON.parse(JSON.stringify(this.options)) as Bot.Options
            this.options=newConfig
            if(isSame(newConfig.plugins,oldConfig.plugins)){
                return process.exit(51)
            }
            this.emit('plugin.config.change',newConfig.plugins,oldConfig.plugins)
        })
    }
    async start (){
        // 自动加载所有用户插件
        const userPluginDir=resolve(process.cwd(),this.options.plugin_dir)
        this.loadLocalPlugins(userPluginDir)
        // 尝试加载npm包中的插件
        this.loadModulePlugins()
        this.watchConfigChange()
        this.watch(userPluginDir,(filename)=>{
            if(!this.pluginDependencies.includes(filename)) return
            for(const [name,plugin] of this.plugins){
                if(plugin.mainFile===filename){
                    console.log(`plugin (${name})${filename} changed，restarting...`)
                    this.restartPlugin(name,plugin,filename)
                    break;
                }
            }
            const needRestartPlugins:[string,Context][]=[]
            for(const [name,plugin] of this.plugins){
                if(plugin.dependencies.includes(filename)){
                    console.log(`plugin (${name}) dependency:${filename} changed，restarting...`)
                    needRestartPlugins.push([name,plugin])
                    break;
                }
            }
            needRestartPlugins.forEach(([name,plugin])=>{
                this.restartPlugin(name,plugin,filename)
            })
        })
        if(this.options.help) useHelp()
        await super.start()
        this.login(this.options.password)
        await this.dispatch('bot.start')
        this.isStarted=true
        await this.dispatch('bot.ready')
        this.isReady=true
    }
}
export interface Bot extends Bot.Services{}
declare global{
    export var __SPOINT_BOT__:Bot
}
export function createBot(uin:number,config:Partial<Bot.Options>|string='bot.yaml'){
    if(typeof config!=="string") writeFileSync(resolve(process.cwd(),config.saveTo||'bot.yaml'),yaml.dump(config),"utf8")
    else {
        if(!existsSync(resolve(process.cwd(),config))){
            writeFileSync(resolve(process.cwd(),config),yaml.dump(Bot.defaultOptions),'utf8')
        }
        config=yaml.load(readFileSync(config,"utf8")) as Bot.Options
    }
    return global.__SPOINT_BOT__=new Bot(uin,config)
}
export namespace Bot{
    export type LogLevel='off'|'info'|'warn'|'error'|'mark'
    export interface Options extends Client.Options{
        saveTo?:string
        master?:number
        log_level?:LogLevel
        help?:boolean
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
        saveTo:'bot.yaml',
        plugins:{},
        help:true,
        log_level:'info',
        remote_url:'ws://localhost:6727/210723495',
        plugin_dir:'plugins',
    }
    export interface Services{
        koa:Koa
    }
}
