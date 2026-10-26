import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { AdminTenantsController, OwnerTenantController, PublicTenantsController, StaffController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [AdminTenantsController, PublicTenantsController, OwnerTenantController, StaffController],
  providers: [TenantsService, StaffService],
  exports: [TenantsService],
})
export class TenantsModule {}
