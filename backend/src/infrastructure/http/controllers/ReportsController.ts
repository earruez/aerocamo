import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FleetReportDocumentService } from '../../../domain/services/FleetReportDocumentService';
import { ComplianceReportDocumentService } from '../../../domain/services/ComplianceReportDocumentService';
import { FleetLookaheadDocumentService } from '../../../domain/services/FleetLookaheadDocumentService';
import { WorkOrderLaborCostDocumentService } from '../../../domain/services/WorkOrderLaborCostDocumentService';

const complianceHistorySchema = z.object({
  aircraftId: z.string().uuid(),
});

const laborCostSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export class ReportsController {
  getFleetSummaryPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pdf = await FleetReportDocumentService.generateExecutiveReport(req.organizationId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Informe-Ejecutivo-Flota-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };

  getComplianceHistoryPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId } = complianceHistorySchema.parse(req.query);
      const pdf = await ComplianceReportDocumentService.generateAircraftReport(req.organizationId, aircraftId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Cumplimiento-Regulatorio-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };

  getFleetLookaheadPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pdf = await FleetLookaheadDocumentService.generateReport(req.organizationId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Vencimientos-Flota-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };

  getWorkOrderLaborCostPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { from, to } = laborCostSchema.parse(req.query);
      const pdf = await WorkOrderLaborCostDocumentService.generateReport(req.organizationId, { from, to });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Horas-Hombre-OT-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };
}
