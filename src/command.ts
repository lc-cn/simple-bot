import {Context, MessageEvent} from "@/context";
import {Bot} from "@/bot";
import {Argv} from "@/argv";
import {Define} from "@/utils";
import {Sendable} from "onebot-client";

export class Command<A extends any[]=any[],O ={},E extends keyof Bot.MessageEvent=keyof Bot.MessageEvent>{
    public name:string
    public parent?:Command
    args:Command.Declaration[]
    public options:Record<string, Command.OptionConfig>={}
    public aliasNames:string[]=[]
    public shortcuts:Command.Shortcut[]=[]
    public examples:string[]=[]
    public descriptions:string[]=[]
    public children:Command[]=[]
    private checkers:Command.Callback<A,O,E>[]=[]
    authorities:Command.Authority[]
    private callback:Command.Callback<A,O,E>[]=[]
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
    match(message:MessageEvent){
        return !this.trigger||this.trigger===message.message_type
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
    option<K extends string,D extends string>(name:K,declaration:D,config:Command.OptionConfig={}):Command<A, Define<O, K, Argv.OptionType<D>>,E>{
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
        return this as any
    }// 添加执行的操作
    action(argv:Command.Callback<A,O,E>){
        this.callback.push(argv)
        return this
    }
    //匹配常规调用参数、选项
    private parseCommand(argv:Argv<A,O,E>){
        const args:A=argv.args||=[] as A
        const options:O=argv.options||={} as O
        while (!argv.error && argv.argv.length) {
            const content=argv.argv.shift()
            const argDecl=this.args[args.length]

            if (content[0] !== '-' && Argv.resolveConfig(argDecl?.type).greedy) {
                args.push(Argv.parseValue([content, ...argv.argv].join(' '), 'argument', argv, argDecl));
                break;
            }
            if (content[0] !== '-' && !Object.values(this.options).find(opt=>opt.shortName===content) && argDecl) {
                if(argDecl.variadic){
                    args.push(...[content].concat(argv.argv).map(str=>Argv.parseValue(str, 'argument', argv, argDecl)));
                    break;
                }else {
                    args.push(Argv.parseValue(content, 'argument', argv, argDecl));
                    continue;
                }
            }
            const optionDecl=[...Object.values(this.options)].find(decl=>decl.shortName===content)
            if(optionDecl && !options[optionDecl.name]){
                if(optionDecl.declaration.required && !optionDecl.initial && (!argv.argv[0] || options[argv.args[0]])){
                    argv.error=`option ${optionDecl.name} is required`
                    break
                }else{
                    if(optionDecl.declaration.type!=="boolean"){
                        if(optionDecl.declaration.variadic){
                            options[optionDecl.name]=argv.argv.map(arg=>Argv.parseValue(arg,'option',argv,optionDecl.declaration))
                            break;
                        } else if(Argv.resolveConfig(optionDecl.declaration.type).greedy){
                            options[optionDecl.name]=Argv.parseValue(argv.argv.join(' '),'option',argv,optionDecl.declaration)
                            break;
                        }else{
                            options[optionDecl.name]=Argv.parseValue(argv.argv.shift(),'option',argv,optionDecl.declaration)
                        }
                    }else{
                        options[optionDecl.name]=Argv.parseValue(content,'option',argv,optionDecl.declaration)
                    }
                    continue
                }
            }
        }

        // assign default values
        for (const [,{name,initial }] of Object.entries(this.options)) {
            if (initial !== undefined && !(name in options)) {
                options[name] = initial
            }
        }
        argv.options=options as O
        argv.args=args as A
    }
    //匹配快捷方式参数、选项
    private parseShortcut(argv:Argv){
        const args=argv.args||=[],options=argv.options||={}
        for(const shortcut of this.shortcuts){
            if(typeof shortcut.name==='string' && argv.cqCode){
                args.push(...(shortcut.args||[]))
                Object.assign(options,shortcut.options||{})
            }
            if(shortcut.name instanceof RegExp){
                const matched=argv.cqCode.match(shortcut.name)
                if(matched){
                    matched.forEach((str,index)=>{
                        if(index===0)return
                        if(shortcut.args){
                            shortcut.args.forEach((arg,i)=>{
                                if(typeof arg==='string' && arg.includes(`${index}`)){
                                    args.push(Argv.parseValue(arg.replace(`$${index}`,str),'argument',argv,this.args[i]))
                                }
                            })
                        }
                        if(shortcut.options){
                            Object.keys(shortcut.options).forEach(key=>{
                                if(this.options[key] && typeof shortcut.options[key]==='string' && shortcut.options[key].includes(`$${index}`)){
                                    options[key]=Argv.parseValue(shortcut.options[key].replace(`$${index}`,str),'option',argv,Object.values(this.options).find(opt=>opt.name=key))
                                }
                            })
                        }
                    })
                }
            }
        }
        return {args,options}
    }
    // 执行指令
    async execute(argv:Argv<A, O,E>):Promise<Sendable|boolean|void>{
        // 匹配参数、选项
        this.parseShortcut(argv)
        if(argv.error){
            return argv.error
        }
        this.parseCommand(argv)
        if(argv.error){
            return argv.error
        }
        let result
        for(const callback of this.checkers){
            result=await callback.call(this,argv,...argv.args)
            if(result)return result
        }
        for(const callback of this.callback){
            result=await callback.call(this,argv,...argv.args)
            if(result)return result
        }
    }
    //显示帮助信息
    help({simple,showAuth,showHidden,dep=1,current=0}:HelpOptions={}){
        const createArgsOutput=()=>{
            const result=[]
            this.args.forEach((arg)=>{
                const nameDesc:string[]=[]
                nameDesc.push(arg?.required?'<':'[')
                nameDesc.push(arg?.variadic?'...':'')
                nameDesc.push(arg.name+':')
                nameDesc.push(String(arg.type))
                nameDesc.push(arg.required?'>':']')
                result.push(nameDesc.join(''))
            })
            return result.join(' ')
        }
        const output:string[]=[`${this.name} ${createArgsOutput()} ${this.descriptions.join(';')}`]
        if(!simple){
            if(showAuth) output.push(`authority:${this.authorities.join()}`)
            if(this.aliasNames.length)output.push(` alias:${this.aliasNames.join(',')}`)
            if(this.shortcuts.length)output.push(` shortcuts:${this.shortcuts.map(shortcut=>String(shortcut.name))}`)
            if(this.options && Object.keys(this.options).length){
                const options=Object.keys(this.options)
                    .filter(name=>!name.startsWith('-'))
                    .filter(name=>showHidden?true:!this.options[name].hidden)
                if(options.length){
                    output.push(' options:')
                    options.forEach(key=>{
                        const nameDesc:string[]=[]
                        const option=this.options[key]
                        nameDesc.push(option.declaration?.required?'<':'[')
                        nameDesc.push(option.declaration?.variadic?'...':'')
                        nameDesc.push(key+':')
                        nameDesc.push(String(option.declaration.type))
                        nameDesc.push(option.declaration?.required?'>':']')
                        output.push(`  ${option.shortName} ${nameDesc.join('')} ${option.description}`)
                    })
                }
            }
        }
        if(this.children.length && dep!==current){
            output.push(' children:')
            return output.concat(...this.children.map(children=>children.help({simple,showAuth,showHidden,current:current+1,dep}).map(str=>`${new Array((current+1)*2).fill(' ').join('')}${str}`)).flat())
        }
        return output
    }
}
interface HelpOptions{
    showHidden?:boolean
    showAuth?:boolean
    dep?:number
    current?:number
    simple?:boolean
}
export namespace Command{
    export interface Declaration {
        name?: string
        type?: Argv.Type
        initial?: any
        variadic?: boolean
        required?: boolean
    }
    export type Authority='admin'|'owner'|'master'|'admins'
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
