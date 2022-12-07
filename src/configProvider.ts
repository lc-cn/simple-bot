export class ConfigProvider<T extends object=object>{
    value:T
    constructor(filePath:string) {
    }
    get config(){
        return this.value
    }
}