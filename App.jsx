import { useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Trash2, Plus, Calculator, Euro, Users, Settings, Save, Edit } from 'lucide-react'
import './App.css'

function App() {
  const [personen, setPersonen] = useState([])
  const [profielen, setProfielen] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bewerkProfiel, setBewerkProfiel] = useState(null)
  const [nieuwProfiel, setNieuwProfiel] = useState({
    naam: '',
    uurtariefPersoon: 0,
    afdrachten: []
  })

  // Functie om een nieuwe persoon toe te voegen vanuit profiel
  const voegPersoonToe = (profielId) => {
    const profiel = profielen.find(p => p.id === profielId)
    if (!profiel) return

    const persoonData = {
      id: Date.now().toString(),
      profielId: profiel.id,
      naam: profiel.naam,
      uurtariefPersoon: profiel.uurtariefPersoon,
      uurtariefKlant: 0, // Flexibel per project
      tijdregistratie: {
        gestart: '',
        gepauzeerd: '',
        hervat: '',
        gestopt: '',
        totaalUren: 0
      },
      actieveAfdrachten: [] // IDs van actieve afdrachten uit het profiel
    }

    setPersonen([...personen, persoonData])
  }

  // Functie om een persoon te verwijderen
  const verwijderPersoon = (id) => {
    setPersonen(personen.filter(p => p.id !== id))
  }

  // Functie om tijdregistratie bij te werken
  const updateTijdregistratie = (id, veld, waarde) => {
    setPersonen(personen.map(p => 
      p.id === id ? { 
        ...p, 
        tijdregistratie: { ...p.tijdregistratie, [veld]: waarde }
      } : p
    ))
  }

  // Functie om klanttarief bij te werken
  const updateKlanttarief = (id, tarief) => {
    setPersonen(personen.map(p => 
      p.id === id ? { ...p, uurtariefKlant: parseFloat(tarief) || 0 } : p
    ))
  }

  // Functie om actieve afdrachten bij te werken
  const updateActieveAfdrachten = (persoonId, afdrachtId, actief) => {
    setPersonen(personen.map(p => 
      p.id === persoonId ? {
        ...p,
        actieveAfdrachten: actief 
          ? [...p.actieveAfdrachten, afdrachtId]
          : p.actieveAfdrachten.filter(id => id !== afdrachtId)
      } : p
    ))
  }

  // PROFIEL MANAGEMENT FUNCTIES
  const startNieuwProfiel = () => {
    setBewerkProfiel(null)
    setNieuwProfiel({
      naam: '',
      uurtariefPersoon: 0,
      afdrachten: []
    })
  }

  const startBewerkProfiel = (profiel) => {
    setBewerkProfiel(profiel.id)
    setNieuwProfiel({
      naam: profiel.naam,
      uurtariefPersoon: profiel.uurtariefPersoon,
      afdrachten: [...profiel.afdrachten]
    })
  }

  const opslaanProfiel = () => {
    if (!nieuwProfiel.naam.trim()) return
    
    if (bewerkProfiel) {
      // Bewerk bestaand profiel
      setProfielen(profielen.map(p => 
        p.id === bewerkProfiel ? { ...p, ...nieuwProfiel } : p
      ))
      // Update ook actieve personen met dit profiel
      setPersonen(personen.map(p => 
        p.profielId === bewerkProfiel ? {
          ...p,
          naam: nieuwProfiel.naam,
          uurtariefPersoon: nieuwProfiel.uurtariefPersoon
        } : p
      ))
    } else {
      // Nieuw profiel
      const profiel = {
        id: Date.now().toString(),
        ...nieuwProfiel,
        afdrachten: nieuwProfiel.afdrachten.map(a => ({
          ...a,
          id: Date.now().toString() + Math.random()
        }))
      }
      setProfielen([...profielen, profiel])
    }
    
    startNieuwProfiel()
  }

  const verwijderProfiel = (profielId) => {
    setProfielen(profielen.filter(p => p.id !== profielId))
    // Verwijder ook personen met dit profiel
    setPersonen(personen.filter(p => p.profielId !== profielId))
  }

  const voegProfielAfdrachtToe = () => {
    setNieuwProfiel({
      ...nieuwProfiel,
      afdrachten: [...nieuwProfiel.afdrachten, {
        id: Date.now().toString(),
        basis: 'uurloon', // 'uurloon' of 'marge'
        type: 'percentage',
        waarde: 0,
        aanProfielId: '' // Nu ID in plaats van naam
      }]
    })
  }

  const updateProfielAfdracht = (afdrachtId, veld, waarde) => {
    setNieuwProfiel({
      ...nieuwProfiel,
      afdrachten: nieuwProfiel.afdrachten.map(a => 
        a.id === afdrachtId ? { ...a, [veld]: waarde } : a
      )
    })
  }

  const verwijderProfielAfdracht = (afdrachtId) => {
    setNieuwProfiel({
      ...nieuwProfiel,
      afdrachten: nieuwProfiel.afdrachten.filter(a => a.id !== afdrachtId)
    })
  }

  // Bereken totaal uren voor een persoon
  const berekenTotaalUren = (tijdregistratie) => {
    if (tijdregistratie.totaalUren > 0) {
      return tijdregistratie.totaalUren
    }
    
    if (tijdregistratie.gestart && tijdregistratie.gestopt) {
      const start = new Date(`2024-01-01T${tijdregistratie.gestart}:00`)
      const stop = new Date(`2024-01-01T${tijdregistratie.gestopt}:00`)
      const verschilMs = stop - start
      return Math.max(0, verschilMs / (1000 * 60 * 60))
    }
    
    return 0
  }

  // Bereken financiële gegevens voor een persoon met hiërarchische afdrachten
  const berekenFinancieel = (persoon) => {
    const totaalUren = berekenTotaalUren(persoon.tijdregistratie)
    const kosten = totaalUren * persoon.uurtariefPersoon
    const loon = totaalUren * persoon.uurtariefKlant
    const brutoMarge = loon - kosten
    
    // Bereken actieve afdrachten met prioriteit
    const profiel = profielen.find(p => p.id === persoon.profielId)
    let uurloonAfdrachten = 0
    let margeAfdrachten = 0
    
    if (profiel) {
      // Stap 1: Bereken afdrachten op uurloon (prioriteit 1)
      profiel.afdrachten.forEach(afdracht => {
        if (persoon.actieveAfdrachten.includes(afdracht.id) && afdracht.basis === 'uurloon') {
          if (afdracht.type === 'percentage') {
            uurloonAfdrachten += kosten * (afdracht.waarde / 100)
          } else if (afdracht.type === 'vastbedrag') {
            uurloonAfdrachten += afdracht.waarde
          }
        }
      })
      
      // Stap 2: Bereken resterende marge na uurloon afdrachten
      const resterendeMarge = Math.max(0, brutoMarge - uurloonAfdrachten)
      
      // Stap 3: Bereken afdrachten op resterende marge (prioriteit 2)
      profiel.afdrachten.forEach(afdracht => {
        if (persoon.actieveAfdrachten.includes(afdracht.id) && afdracht.basis === 'marge') {
          if (afdracht.type === 'percentage') {
            margeAfdrachten += resterendeMarge * (afdracht.waarde / 100)
          } else if (afdracht.type === 'vastbedrag') {
            margeAfdrachten += Math.min(afdracht.waarde, resterendeMarge - margeAfdrachten)
          }
        }
      })
    }
    
    const totaleAfdrachten = uurloonAfdrachten + margeAfdrachten
    const nettoMarge = brutoMarge - totaleAfdrachten
    
    return {
      totaalUren,
      kosten,
      loon,
      brutoMarge,
      uurloonAfdrachten,
      margeAfdrachten,
      totaleAfdrachten,
      nettoMarge
    }
  }

  // Bereken uitbetalingen (correcte marge pool verdeling)
  const berekenUitbetalingen = () => {
    const uitbetalingen = {}
    
    // Stap 1: Initialiseer alle profielen in de uitbetalingen object
    profielen.forEach(profiel => {
      uitbetalingen[profiel.id] = {
        naam: profiel.naam,
        eigenLoon: 0,
        ontvangenUurloonAfdrachten: 0,
        ontvangenMargeAfdrachten: 0,
        totaal: 0
      }
    })

    // Stap 2: Voeg het basisloon toe voor elke actieve persoon
    personen.forEach(persoon => {
      const financieel = berekenFinancieel(persoon)
      if (uitbetalingen[persoon.profielId]) {
        uitbetalingen[persoon.profielId].eigenLoon += financieel.kosten
        uitbetalingen[persoon.profielId].totaal += financieel.kosten
      }
    })

    // Stap 2: Bereken totale marge pool
    let totaleMarge = 0
    personen.forEach(persoon => {
      const financieel = berekenFinancieel(persoon)
      totaleMarge += financieel.brutoMarge
    })

    // Stap 3: Verdeel marge volgens hiërarchische afdrachten
    let resterendeMarge = totaleMarge

    // Eerst: Uurloon afdrachten (prioriteit 1)
    personen.forEach(persoon => {
      const profiel = profielen.find(p => p.id === persoon.profielId)
      const financieel = berekenFinancieel(persoon)
      
      if (profiel) {
        profiel.afdrachten.forEach(afdracht => {
          if (persoon.actieveAfdrachten.includes(afdracht.id) && 
              afdracht.basis === 'uurloon' && 
              afdracht.aanProfielId &&
              uitbetalingen[afdracht.aanProfielId]) {
            
            let afdrachtBedrag = 0
            if (afdracht.type === 'percentage') {
              afdrachtBedrag = financieel.kosten * (afdracht.waarde / 100)
            } else if (afdracht.type === 'vastbedrag') {
              afdrachtBedrag = Math.min(afdracht.waarde, resterendeMarge)
            }
            
            afdrachtBedrag = Math.min(afdrachtBedrag, resterendeMarge)
            uitbetalingen[afdracht.aanProfielId].ontvangenUurloonAfdrachten += afdrachtBedrag
            uitbetalingen[afdracht.aanProfielId].totaal += afdrachtBedrag
            resterendeMarge -= afdrachtBedrag
          }
        })
      }
    })

    // Daarna: Marge afdrachten (prioriteit 2) - gelijktijdig berekenen
    const margeAfdrachten = []
    personen.forEach(persoon => {
      const profiel = profielen.find(p => p.id === persoon.profielId)
      
      if (profiel) {
        profiel.afdrachten.forEach(afdracht => {
          if (persoon.actieveAfdrachten.includes(afdracht.id) && 
              afdracht.basis === 'marge' && 
              afdracht.aanProfielId &&
              uitbetalingen[afdracht.aanProfielId]) {
            
            margeAfdrachten.push({
              aanProfielId: afdracht.aanProfielId,
              type: afdracht.type,
              waarde: afdracht.waarde
            })
          }
        })
      }
    })

    // Bereken gewenste bedragen voor alle marge afdrachten
    let totaalGewenstBedrag = 0
    const gewensteBedragen = margeAfdrachten.map(afdracht => {
      let gewenstBedrag = 0
      if (afdracht.type === 'percentage') {
        gewenstBedrag = resterendeMarge * (afdracht.waarde / 100)
      } else if (afdracht.type === 'vastbedrag') {
        gewenstBedrag = afdracht.waarde
      }
      totaalGewenstBedrag += gewenstBedrag
      return { ...afdracht, gewenstBedrag }
    })

    // Verdeel de resterende marge
    gewensteBedragen.forEach(afdracht => {
      let afdrachtBedrag = 0
      
      if (totaalGewenstBedrag <= resterendeMarge) {
        // Er is genoeg marge voor iedereen
        afdrachtBedrag = afdracht.gewenstBedrag
      } else {
        // Proportionele verdeling als er niet genoeg is
        const proportie = afdracht.gewenstBedrag / totaalGewenstBedrag
        afdrachtBedrag = resterendeMarge * proportie
      }
      
      uitbetalingen[afdracht.aanProfielId].ontvangenMargeAfdrachten += afdrachtBedrag
      uitbetalingen[afdracht.aanProfielId].totaal += afdrachtBedrag
    })

    return Object.values(uitbetalingen)
  }

  // Bereken totalen
  const berekenTotalen = () => {
    const totalen = personen.reduce((acc, persoon) => {
      const financieel = berekenFinancieel(persoon)
      return {
        klantFactuur: acc.klantFactuur + financieel.loon,
        totaleAfdrachten: acc.totaleAfdrachten + financieel.totaleAfdrachten
      }
    }, { klantFactuur: 0, totaleAfdrachten: 0 })
    
    return totalen
  }

  const totalen = berekenTotalen()
  const uitbetalingen = berekenUitbetalingen()

  return (
    <div className="min-h-screen bg-background p-2">
      <div className="max-w-6xl mx-auto">
        {/* Compacte Header met Settings */}
        <div className="mb-3 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Urenregistratie Calculator
            </h1>
          </div>
          
          {/* Settings Button */}
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <Settings className="h-3 w-3 mr-1" />
                Profielen
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Persoon Profielen Beheren</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Bestaande Profielen */}
                <div>
                  <h3 className="text-sm font-medium mb-2">Bestaande Profielen</h3>
                  <div className="space-y-2">
                    {profielen.map(profiel => (
                      <div key={profiel.id} className="flex justify-between items-center p-2 border rounded text-xs">
                        <div>
                          <span className="font-medium">{profiel.naam}</span>
                          <span className="text-muted-foreground ml-2">
                            €{profiel.uurtariefPersoon}/u
                          </span>
                          {profiel.afdrachten.length > 0 && (
                            <span className="text-muted-foreground ml-2">
                              ({profiel.afdrachten.length} afdracht{profiel.afdrachten.length !== 1 ? 'en' : ''})
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            onClick={() => startBewerkProfiel(profiel)}
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            onClick={() => verwijderProfiel(profiel.id)}
                            variant="destructive"
                            size="sm"
                            className="h-6 text-xs"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {profielen.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nog geen profielen aangemaakt</p>
                    )}
                  </div>
                </div>

                {/* Profiel Bewerken/Aanmaken */}
                <div className="border-t pt-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-medium">
                      {bewerkProfiel ? 'Profiel Bewerken' : 'Nieuw Profiel'}
                    </h3>
                    {bewerkProfiel && (
                      <Button
                        onClick={startNieuwProfiel}
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                      >
                        Nieuw
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <Input
                      className="h-7 text-xs"
                      value={nieuwProfiel.naam}
                      onChange={(e) => setNieuwProfiel({...nieuwProfiel, naam: e.target.value})}
                      placeholder="Naam"
                    />
                    <Input
                      className="h-7 text-xs"
                      type="number"
                      step="0.01"
                      value={nieuwProfiel.uurtariefPersoon}
                      onChange={(e) => setNieuwProfiel({...nieuwProfiel, uurtariefPersoon: parseFloat(e.target.value) || 0})}
                      placeholder="Persoon €/u"
                    />
                  </div>

                  {/* Afdrachten voor profiel */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-medium">Mogelijke Afdrachten</label>
                      <Button
                        onClick={voegProfielAfdrachtToe}
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Afdracht
                      </Button>
                    </div>
                    
                    <div className="text-xs text-muted-foreground mb-2">
                      <strong>Prioriteit:</strong> Uurloon afdrachten gaan vóór marge afdrachten
                    </div>
                    
                    {nieuwProfiel.afdrachten.map((afdracht) => (
                      <div key={afdracht.id} className="grid grid-cols-5 gap-2 mb-2 p-2 bg-muted/30 rounded">
                        <Select
                          value={afdracht.basis}
                          onValueChange={(value) => updateProfielAfdracht(afdracht.id, 'basis', value)}
                        >
                          <SelectTrigger className="h-6 text-xs">
                            <SelectValue placeholder="Basis" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="uurloon">Uurloon</SelectItem>
                            <SelectItem value="marge">Marge</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Select
                          value={afdracht.type}
                          onValueChange={(value) => updateProfielAfdracht(afdracht.id, 'type', value)}
                        >
                          <SelectTrigger className="h-6 text-xs">
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">%</SelectItem>
                            <SelectItem value="vastbedrag">€</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Input
                          className="h-6 text-xs"
                          type="number"
                          step={afdracht.type === 'percentage' ? '1' : '0.01'}
                          value={afdracht.waarde}
                          onChange={(e) => updateProfielAfdracht(afdracht.id, 'waarde', parseFloat(e.target.value) || 0)}
                          placeholder={afdracht.type === 'percentage' ? '25' : '50'}
                        />
                        
                        <Select
                          value={afdracht.aanProfielId}
                          onValueChange={(value) => updateProfielAfdracht(afdracht.id, 'aanProfielId', value)}
                        >
                          <SelectTrigger className="h-6 text-xs">
                            <SelectValue placeholder="Aan profiel..." />
                          </SelectTrigger>
                          <SelectContent>
                            {profielen
                              .filter(p => p.id !== bewerkProfiel) // Niet aan jezelf afdragen
                              .map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.naam}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        
                        <Button
                          onClick={() => verwijderProfielAfdracht(afdracht.id)}
                          size="sm"
                          variant="destructive"
                          className="h-6 text-xs"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={opslaanProfiel}
                    className="w-full h-7 text-xs"
                    disabled={!nieuwProfiel.naam.trim()}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {bewerkProfiel ? 'Wijzigingen Opslaan' : 'Profiel Opslaan'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Vereenvoudigd Overzicht */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          {/* Klant Factuur */}
          <Card className="p-2">
            <CardContent className="p-0">
              <div className="text-center">
                <div className="text-xs font-medium text-muted-foreground mb-1">Klant Betaalt</div>
                <div className="text-xl font-bold text-green-600">€{totalen.klantFactuur.toFixed(0)}</div>
              </div>
            </CardContent>
          </Card>

          {/* Uitbetalingen */}
          <Card className="p-2">
            <CardContent className="p-0">
              <div className="text-xs font-medium text-muted-foreground mb-2">Uitbetalingen</div>
              <div className="space-y-1">
                {uitbetalingen.map((uitbetaling, index) => (
                  <div key={index} className="flex justify-between items-center text-xs">
                    <span className="font-medium">{uitbetaling.naam}</span>
                    <div className="flex items-center gap-2">
                      {(uitbetaling.ontvangenUurloonAfdrachten > 0 || uitbetaling.ontvangenMargeAfdrachten > 0) && (
                        <span className="text-muted-foreground">
                          €{uitbetaling.eigenLoon.toFixed(0)}
                          {uitbetaling.ontvangenUurloonAfdrachten > 0 && (
                            <span className="text-blue-600"> +€{uitbetaling.ontvangenUurloonAfdrachten.toFixed(0)}</span>
                          )}
                          {uitbetaling.ontvangenMargeAfdrachten > 0 && (
                            <span className="text-orange-600"> +€{uitbetaling.ontvangenMargeAfdrachten.toFixed(0)}</span>
                          )}
                        </span>
                      )}
                      <span className="font-bold">€{uitbetaling.totaal.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
                {uitbetalingen.length === 0 && (
                  <div className="text-center text-muted-foreground text-xs py-2">
                    Geen personen toegevoegd
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Personen Sectie */}
        <Card className="p-2">
          <CardHeader className="p-0 mb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm">Personen & Uren</CardTitle>
              <div className="flex gap-2">
                {profielen.length > 0 ? (
                  <Select onValueChange={(profielId) => voegPersoonToe(profielId)}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue placeholder="Voeg persoon toe..." />
                    </SelectTrigger>
                    <SelectContent>
                      {profielen.map(profiel => (
                        <SelectItem key={profiel.id} value={profiel.id}>
                          {profiel.naam}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-xs text-muted-foreground">Maak eerst profielen aan</div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {personen.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <Users className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">Selecteer een profiel om te beginnen</p>
              </div>
            ) : (
              <div className="space-y-2">
                {personen.map((persoon) => {
                  const financieel = berekenFinancieel(persoon)
                  const profiel = profielen.find(p => p.id === persoon.profielId)
                  
                  return (
                    <div key={persoon.id} className="border rounded p-2 bg-card">
                      {/* Compacte Persoon Info */}
                      <div className="grid grid-cols-7 gap-2 mb-2">
                        <div className="font-medium text-xs">{persoon.naam}</div>
                        <Input
                          className="h-6 text-xs"
                          type="time"
                          value={persoon.tijdregistratie.gestart}
                          onChange={(e) => updateTijdregistratie(persoon.id, 'gestart', e.target.value)}
                          placeholder="Start"
                        />
                        <Input
                          className="h-6 text-xs"
                          type="time"
                          value={persoon.tijdregistratie.gestopt}
                          onChange={(e) => updateTijdregistratie(persoon.id, 'gestopt', e.target.value)}
                          placeholder="Stop"
                        />
                        <Input
                          className="h-6 text-xs"
                          type="number"
                          step="0.25"
                          value={persoon.tijdregistratie.totaalUren}
                          onChange={(e) => updateTijdregistratie(persoon.id, 'totaalUren', parseFloat(e.target.value) || 0)}
                          placeholder="Uren"
                        />
                        <Input
                          className="h-6 text-xs"
                          type="number"
                          step="0.01"
                          value={persoon.uurtariefKlant}
                          onChange={(e) => updateKlanttarief(persoon.id, e.target.value)}
                          placeholder="Klant €/u"
                        />
                        <div className="text-xs text-center">
                          <div className="text-muted-foreground">Loon</div>
                          <div className="font-bold text-green-600">€{financieel.loon.toFixed(0)}</div>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => verwijderPersoon(persoon.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Afdrachten Multi-Select */}
                      {profiel && profiel.afdrachten.length > 0 && (
                        <div className="border-t pt-2">
                          <div className="text-xs font-medium mb-1">Actieve Afdrachten:</div>
                          <div className="flex flex-wrap gap-2">
                            {profiel.afdrachten.map((afdracht) => {
                              const ontvangerProfiel = profielen.find(p => p.id === afdracht.aanProfielId)
                              return (
                                <div key={afdracht.id} className="flex items-center space-x-1">
                                  <Checkbox
                                    id={`${persoon.id}-${afdracht.id}`}
                                    checked={persoon.actieveAfdrachten.includes(afdracht.id)}
                                    onCheckedChange={(checked) => updateActieveAfdrachten(persoon.id, afdracht.id, checked)}
                                  />
                                  <label htmlFor={`${persoon.id}-${afdracht.id}`} className="text-xs">
                                    <span className={afdracht.basis === 'uurloon' ? 'text-blue-600' : 'text-orange-600'}>
                                      {afdracht.waarde}{afdracht.type === 'percentage' ? '%' : '€'} van {afdracht.basis}
                                    </span>
                                    {ontvangerProfiel && (
                                      <span> → {ontvangerProfiel.naam}</span>
                                    )}
                                  </label>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App

