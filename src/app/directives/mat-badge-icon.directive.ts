import { Directive, Input, ElementRef, inject, OnChanges, SimpleChanges } from "@angular/core";
import { IconService } from "../icon.service";

@Directive({
  selector: '[matBadgeHidden][matBadgeIcon]',
  standalone: true,
})
export class MatBadgeIconDirective implements OnChanges {
  private _iconService = inject(IconService);//TODO: Map the object error stats to icons
  @Input() matBadgeIcon!: string;

  constructor(private _el: ElementRef) { }

  ngOnInit() {
    this._applyIcon();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['matBadgeIcon'] && !changes['matBadgeIcon'].isFirstChange()) {
      this._applyIcon();
    }
  }

  private _applyIcon() {
    const badge = this._el.nativeElement.querySelector('.mat-badge-content');
    if (!badge) return;
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.innerHTML = `<i class="material-icons" style="font-size: 20px">${this.matBadgeIcon}</i>`;
  }
}