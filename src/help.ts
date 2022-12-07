import {useContext} from "@/context";

export function useHelp(){
    const ctx = useContext()
    ctx.command('help [command:string]')
        .desc('显示指令的帮助信息')
        .shortcut('帮助', {fuzzy: true})
        .option('showHidden', '-H 显示隐藏选项')
        .option('showAuth', '-A 显示权限信息')
        .action(({event, options, argv}, target) => {
            if (!target) {
                const commands = ctx.bot.commandList.filter(cmd => !cmd.parent)
                const output = commands.map((command) => command.help({...options, simple: true, dep: 0})).flat()
                output.push('回复“帮助 指令名”以查看对应指令帮助。')
                return output.filter(Boolean).join('\n')
            }

            const command = ctx.findCommand({name: target, event, cqCode: event.cqCode, argv})
            if (!command?.match(event)) {
                return
            }

            return command.help({...options, dep: 1}).concat('回复“帮助 指令名”以查看对应指令帮助。').join('\n')
        })

}