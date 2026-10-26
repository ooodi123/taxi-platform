"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsModule = void 0;
const common_1 = require("@nestjs/common");
const staff_service_1 = require("./staff.service");
const tenants_controller_1 = require("./tenants.controller");
const tenants_service_1 = require("./tenants.service");
let TenantsModule = class TenantsModule {
};
exports.TenantsModule = TenantsModule;
exports.TenantsModule = TenantsModule = __decorate([
    (0, common_1.Module)({
        controllers: [tenants_controller_1.AdminTenantsController, tenants_controller_1.PublicTenantsController, tenants_controller_1.OwnerTenantController, tenants_controller_1.StaffController],
        providers: [tenants_service_1.TenantsService, staff_service_1.StaffService],
        exports: [tenants_service_1.TenantsService],
    })
], TenantsModule);
