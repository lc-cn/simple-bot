import {Context} from "@/context";
import {Bot} from "@/bot";
import {Argv} from "@/argv";
import {Define} from "@/utils";
import {Sendable} from "oicq";

export class Command<A extends any[]=[],O ={},E extends keyof Bot.MessageEvent=keyof Bot.MessageEvent>{
    public name:string
    public parent?:Command
    args:Command.Declaration[]
    public options:Record<string, Command.OptionConfig>={}
    public aliasNames:string[]=[]
    public shortcuts:Command.Shortcut[]=[]
    public examples:string[]=[]
    public descriptions:string[]=[]
    public children:Command[]=[]
    public ctx:Context
    constructor(declaration:string,public trigger:E) {
        this.name=Command.removeDeclarationArgs(declaration)
        this.args=Command.findDeclarationArgs(declaration)
    }
    alias(name:string){
        this.aliasNames.push(name)
        return this
    }
    // 为指令添加其他选项
    use(callback:(cmd:Command)=>any){
        callback(this)
    }
    // 添加指令描述文本
    desc(desc:string){
        this.descriptions.push(desc)
        return this
    }
    // 添加快捷方式
    shortcut(reg:RegExp|string,config:Command.Shortcut={}){
        this.shortcuts.push({...config,name:reg})
        return this
    }
    // 定义样例
    example(example:string){
        this.examples.push(example)
        return this
    }
    command<D extends string,E extends keyof Bot.MessageEvent>(decl:D,trigger?:E):Command<Argv.ArgumentType<D>,{},E>{
        const command=this.ctx.command(decl,trigger)
        command.parent=this
        command.ctx=this.ctx
        this.children.push(command)
        return Object.create(command)
    }
    // 添加选项
    option<K extends string,D extends string>(name:K,declaration:D,config:Command.OptionConfig={}):Command<A, Define<O, K, Argv.OptionType<D>>>{
        const decl = declaration.replace(/(?<=^|\s)[\w\x80-\uffff].*/, '')
        const shortName= Command.removeDeclarationArgs(decl);
        const argDeclaration = Command.findDeclarationArgs(decl)[0]
        let desc = declaration.slice(decl.length).replace(/(?<=^|\s)(<[^<]+>|\[[^[]+\]).*/, '')
        desc = desc.trim() || '--' + name
        if(this.options[name]){
            throw new Error(`command "${this.name}" 的option名重复定义 "${name}"`)
        }
        if(this.options[argDeclaration.name]){
            throw new Error(`command "${this.name}" 的option 缩写名重复使用 "${shortName}"`)
        }
        this.options[shortName] ||= {
            name,
            shortName,
            description: desc,
            ...config,
            declaration:argDeclaration
        }
        this.options[name] ||= {
            name,
            shortName,
            description: desc,
            ...config,
            declaration:argDeclaration
        }
        return this
    }
}
export namespace Command{
    export interface Declaration {
        name?: string
        type?: Argv.Type
        initial?: any
        variadic?: boolean
        required?: boolean
    }
    export interface Shortcut {
        name?: string | RegExp;
        fuzzy?: boolean;
        args?: any[];
        options?: Record<string, any>;
    }
    export type Callback< A extends any[] = any[], O extends {} = {},E extends keyof Bot.MessageEvent=keyof Bot.MessageEvent>
        = (action:Argv<A,O,E>, ...args: A) => Sendable|void|boolean|Promise<Sendable|void|boolean>
    export interface OptionConfig<T extends Argv.Type =Argv.Type> {
        value?: any
        initial?: any
        name?:string
        shortName?:string
        type?: T
        /** hide the option by default */
        hidden?: boolean
        description?:string
        declaration?:Declaration
    }
    export function removeDeclarationArgs(name: string): string {
        return name.replace(/[<[].+/, '').trim();
    }
    export function findDeclarationArgs(declaration: string):Declaration[] {
        const res:Declaration[] = [];
        const ANGLED_BRACKET_RE_GLOBAL = /<([^>]+)>/g
        const SQUARE_BRACKET_RE_GLOBAL = /\[([^\]]+)\]/g
        const BOOLEAN_BRACKET_RE_GLOBAL=/(-\S)+/g
        const parse = (match: string[]) => {
            let variadic = false;
            let [value,type=match[1].startsWith('-')?'boolean':'string'] = match[1].split(':');
            if (value.startsWith('...')) {
                value = value.slice(3)
                variadic = true
            }
            return {
                required: match[0].startsWith('<'),
                name:value,
                type,
                variadic,
            } as Declaration
        }

        let angledMatch
        while ((angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(declaration))) {
            res.push(parse(angledMatch))
        }

        let squareMatch
        while ((squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(declaration))) {
            res.push(parse(squareMatch))
        }
        let booleanParamMatch
        while ((booleanParamMatch=BOOLEAN_BRACKET_RE_GLOBAL.exec(declaration))){
            res.push(parse(booleanParamMatch))
        }
        return res;
    }
}