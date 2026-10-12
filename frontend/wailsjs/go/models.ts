export namespace bootstrap {
	
	export class StackConfig {
	    stackType: string;
	    dbUser: string;
	    dbPassword: string;
	    dbName: string;
	    surrealStorage: string;
	    surrealNs: string;
	    enableSwap: boolean;
	    installCaddy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StackConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stackType = source["stackType"];
	        this.dbUser = source["dbUser"];
	        this.dbPassword = source["dbPassword"];
	        this.dbName = source["dbName"];
	        this.surrealStorage = source["surrealStorage"];
	        this.surrealNs = source["surrealNs"];
	        this.enableSwap = source["enableSwap"];
	        this.installCaddy = source["installCaddy"];
	    }
	}

}

export namespace main {
	
	export class DatabaseInfo {
	    engine: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    namespace?: string;
	    storageType: string;
	    dataPath: string;
	    command: string;
	    connectionString: string;
	    surrealistUri?: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DatabaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.engine = source["engine"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.namespace = source["namespace"];
	        this.storageType = source["storageType"];
	        this.dataPath = source["dataPath"];
	        this.command = source["command"];
	        this.connectionString = source["connectionString"];
	        this.surrealistUri = source["surrealistUri"];
	        this.active = source["active"];
	    }
	}
	export class ServiceStatus {
	    name: string;
	    active: boolean;
	    running: boolean;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.active = source["active"];
	        this.running = source["running"];
	        this.status = source["status"];
	    }
	}
	export class ServerOverview {
	    telemetry?: sshclient.Telemetry;
	    services: ServiceStatus[];
	    deployedApps: string[];
	
	    static createFrom(source: any = {}) {
	        return new ServerOverview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.telemetry = this.convertValues(source["telemetry"], sshclient.Telemetry);
	        this.services = this.convertValues(source["services"], ServiceStatus);
	        this.deployedApps = source["deployedApps"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace sshclient {
	
	export class Telemetry {
	    totalRamMb: number;
	    usedRamMb: number;
	    ramPercent: number;
	    diskUsed: string;
	    diskAvail: string;
	    uptime: string;
	    loadAvg: string;
	
	    static createFrom(source: any = {}) {
	        return new Telemetry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalRamMb = source["totalRamMb"];
	        this.usedRamMb = source["usedRamMb"];
	        this.ramPercent = source["ramPercent"];
	        this.diskUsed = source["diskUsed"];
	        this.diskAvail = source["diskAvail"];
	        this.uptime = source["uptime"];
	        this.loadAvg = source["loadAvg"];
	    }
	}

}

export namespace store {
	
	export class ArtifactRule {
	    local: string;
	    remote: string;
	
	    static createFrom(source: any = {}) {
	        return new ArtifactRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.local = source["local"];
	        this.remote = source["remote"];
	    }
	}
	export class BuildStep {
	    name: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new BuildStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.command = source["command"];
	    }
	}
	export class ProjectConfig {
	    id: string;
	    name: string;
	    localPath: string;
	    serverId: string;
	    appDir: string;
	    buildSteps: BuildStep[];
	    artifacts: ArtifactRule[];
	    sharedFiles: string[];
	    restartCommand: string;
	    healthUrl: string;
	    keepReleases: number;
	
	    static createFrom(source: any = {}) {
	        return new ProjectConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.localPath = source["localPath"];
	        this.serverId = source["serverId"];
	        this.appDir = source["appDir"];
	        this.buildSteps = this.convertValues(source["buildSteps"], BuildStep);
	        this.artifacts = this.convertValues(source["artifacts"], ArtifactRule);
	        this.sharedFiles = source["sharedFiles"];
	        this.restartCommand = source["restartCommand"];
	        this.healthUrl = source["healthUrl"];
	        this.keepReleases = source["keepReleases"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ServerConfig {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    authType: string;
	    keyPath?: string;
	    keyContent?: string;
	    password?: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.authType = source["authType"];
	        this.keyPath = source["keyPath"];
	        this.keyContent = source["keyContent"];
	        this.password = source["password"];
	    }
	}

}

