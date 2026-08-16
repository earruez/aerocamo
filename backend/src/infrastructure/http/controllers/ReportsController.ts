import { Request, Response, NextFunction } from 'express';
import { FleetReportDocumentService } from '../../../domain/services/FleetReportDocumentService';

export class ReportsController {
  getFleetSummaryPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pdf = await FleetReportDocumentService.generateExecutiveReport(req.organizationId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Informe-Ejecutivo-Flota-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };
}
